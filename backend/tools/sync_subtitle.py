#!/usr/bin/env python3
"""
sync_subtitle.py - fix a subtitle's timing against a video's (or audio's) speech. No AI.

    python sync_subtitle.py MEDIA SUBTITLE.srt -o OUT.srt [--cache-dir DIR] [--progress-json]

How it works (see PHASE11 notes):
  1. ffsubsync listens to the audio and builds a "speech map" (where people talk, 100 Hz).
     The map is cached, so syncing another subtitle for the same video skips this step.
     First pass is a *global* alignment: one offset + a framerate correction
     (this fixes a constant delay and steady drift, e.g. 23.976 vs 25 fps).
  2. Second pass is *piecewise* (alass-style split mode): the offset may change along the
     timeline (a delay of -2 s that becomes -3 s halfway, an ad break cut out, ...).
  3. The piecewise result is cleaned up before it is trusted: the split search sometimes gives
     every cue in a hard stretch (loud music, overlapping talk) its own random offset. Only
     stretches backed by many consecutive cues are kept; the cues in between get one of the two
     neighbouring offsets, switching exactly where the speech map fits best.
  4. A quality score (how much of each cue lies on speech) is computed before and after; the
     new file is only written when it really is better.

Progress is printed as one line per update (JSON lines with --progress-json) so a web page can
show a progress bar; the final report (offsets along the timeline, scores, timings) is
written next to the output as OUT.report.json.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

import numpy as np
import srt

# ---- tunables (chosen on test cases made from a real episode; see PHASE11 notes) ----
SPLIT_PENALTY = 10          # ffsubsync/alass cost of starting a new offset segment
MAX_OFFSET_SECONDS = 150    # largest offset the piecewise pass may search (covers a 90 s ad break)
RUN_TOLERANCE = 0.30        # cues whose offsets differ less than this belong to the same segment
MIN_RUN_CUES = 10           # a segment needs at least this many consecutive cues to be considered
MIN_PEAK_Z = 3.0            # ... and its offset must stand out from the other offsets (see peak_z)
PEAK_RANGE_SECONDS = 150    # offsets tried when judging how much an offset stands out
PEAK_STEP_SECONDS = 0.5
FRAMERATE_EPS = 0.0005      # below this a framerate correction counts as "none"
MIN_CANDIDATE_GAIN = 0.003  # a piecewise candidate must beat the global result by this to be used
MIN_QUALITY_GAIN = 0.02     # the new file must raise the speech-overlap score by at least this
SPEECH_HZ = 100


# ============================ progress ============================


class Progress:
    """Percent 0..100 across the whole job, a short stage name and a human message."""

    def __init__(self, as_json: bool):
        self.as_json = as_json
        self.last = -1.0

    def emit(self, percent: float, stage: str, message: str):
        percent = max(self.last, min(100.0, percent))  # never goes backwards
        self.last = percent
        if self.as_json:
            print(json.dumps({"percent": round(percent, 1), "stage": stage, "message": message}), flush=True)
        else:
            print(f"[{percent:5.1f}%] {message}", flush=True)


# ============================ subtitle io ============================


def read_text(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "utf-16"):
        try:
            return raw.decode(enc)
        except UnicodeError:
            pass
    try:  # Persian/Arabic subtitles are often cp1256
        from charset_normalizer import from_bytes

        best = from_bytes(raw).best()
        if best is not None:
            return str(best)
    except Exception:
        pass
    return raw.decode("cp1256", errors="replace")


def parse_srt(path: Path) -> list[srt.Subtitle]:
    cues = list(srt.parse(read_text(path)))
    if not cues:
        raise SystemExit(f"No subtitle lines found in {path}")
    return cues


def write_srt(path: Path, cues: list[srt.Subtitle]) -> None:
    path.write_text(srt.compose(cues, reindex=True), encoding="utf-8")


# ============================ speech map maths ============================


def load_speech(npz: Path) -> np.ndarray:
    return np.asarray(np.load(npz)["speech"], dtype=np.float64)


def speech_prefix(speech: np.ndarray) -> np.ndarray:
    """prefix[i] = speech seconds in the first i samples; overlap of any span is O(1)."""
    return np.concatenate([[0.0], np.cumsum(speech > 0.5)]) / SPEECH_HZ


def overlap(prefix: np.ndarray, start: float, end: float) -> float:
    """Seconds of speech between start and end (seconds)."""
    n = len(prefix) - 1
    a = min(max(int(round(start * SPEECH_HZ)), 0), n)
    b = min(max(int(round(end * SPEECH_HZ)), 0), n)
    return float(prefix[b] - prefix[a]) if b > a else 0.0


EDGE_PAD_SECONDS = 0.6


def fit_score(prefix: np.ndarray, start: float, end: float) -> float:
    """
    How well a cue at [start, end] agrees with the speech map: speech inside the cue counts for it,
    speech just outside its edges counts against it (people stop talking where a cue ends).
    Unlike plain overlap this can tell apart two places that are both full of speech.
    """
    inside = overlap(prefix, start, end)
    outside = overlap(prefix, start - EDGE_PAD_SECONDS, start) + overlap(prefix, end, end + EDGE_PAD_SECONDS)
    return 2.0 * inside - (end - start) - 2.0 * outside + 2.0 * EDGE_PAD_SECONDS


def quality(prefix: np.ndarray, spans: list[tuple[float, float]]) -> float:
    """Share of subtitle time that lies on speech (0..1). A well-synced subtitle scores high."""
    total = sum(max(e - s, 0.0) for s, e in spans)
    if total <= 0:
        return 0.0
    return sum(overlap(prefix, s, e) for s, e in spans) / total


def peak_z(prefix: np.ndarray, spans: list[tuple[float, float]], offset: float) -> float:
    """
    How much better `offset` fits these cues than other offsets (a z-score).
    A real segment has one sharp best offset (z of 4-8); a false one - cues that merely
    land somewhere in a speech-dense stretch - fits about as well at many offsets (z < 2).
    """
    s = np.array([a for a, _ in spans])
    e = np.array([b for _, b in spans])
    dur = float(np.sum(e - s))
    if dur <= 0:
        return 0.0
    n = len(prefix) - 1

    def frac(o: float) -> float:
        a = np.clip(np.round((s + o) * SPEECH_HZ).astype(int), 0, n)
        b = np.clip(np.round((e + o) * SPEECH_HZ).astype(int), 0, n)
        return float(np.sum(prefix[b] - prefix[a]) / dur)

    grid = np.arange(-PEAK_RANGE_SECONDS, PEAK_RANGE_SECONDS + 1e-9, PEAK_STEP_SECONDS)
    curve = np.array([frac(o) for o in grid])
    sd = float(curve.std())
    return (frac(offset) - float(curve.mean())) / sd if sd > 1e-9 else 0.0


# ============================ piecewise clean-up ============================


@dataclass
class Run:
    first: int
    last: int
    offset: float  # median offset of the run

    @property
    def n(self) -> int:
        return self.last - self.first + 1


def find_runs(deltas: list[float], tolerance: float = RUN_TOLERANCE) -> list[Run]:
    """Consecutive cues with (nearly) the same offset form a run."""
    runs: list[Run] = []
    start = 0
    for i in range(1, len(deltas) + 1):
        if i == len(deltas) or abs(deltas[i] - deltas[i - 1]) > tolerance:
            runs.append(Run(start, i - 1, float(np.median(deltas[start:i]))))
            start = i
    return runs


def merge_runs(runs: list[Run], tolerance: float = RUN_TOLERANCE) -> list[Run]:
    out: list[Run] = []
    for r in runs:
        if out and abs(out[-1].offset - r.offset) <= tolerance:
            prev = out[-1]
            total = prev.n + r.n
            out[-1] = Run(prev.first, r.last, (prev.offset * prev.n + r.offset * r.n) / total)
        else:
            out.append(r)
    return out


def clean_offsets(
    spans: list[tuple[float, float]],
    deltas: list[float],
    prefix: np.ndarray,
    min_cues: int = MIN_RUN_CUES,
) -> tuple[list[float], list[dict]]:
    """
    Turn the raw per-cue offsets of the piecewise pass into trustworthy ones.
    Returns (offset for every cue, human-readable segments).
    `spans` are the cues' (start, end) BEFORE the piecewise pass (after the global pass).
    """
    n = len(deltas)
    runs = find_runs(deltas)
    candidates = merge_runs([r for r in runs if r.n >= min_cues])
    trusted = [r for r in candidates if peak_z(prefix, spans[r.first : r.last + 1], r.offset) >= MIN_PEAK_Z]
    trusted = merge_runs(trusted)
    if not trusted:
        return [0.0] * n, []  # nothing credible: keep the global result

    final = [0.0] * n
    for r in trusted:
        for i in range(r.first, r.last + 1):
            final[i] = r.offset

    def gain(i: int, offset: float) -> float:
        s, e = spans[i]
        return fit_score(prefix, s + offset, e + offset)

    # Cues outside every trusted run: before the first, between runs, after the last.
    first = trusted[0]
    for i in range(0, first.first):
        final[i] = first.offset
    last = trusted[-1]
    for i in range(last.last + 1, n):
        final[i] = last.offset
    for left, right in zip(trusted, trusted[1:]):
        lo, hi = left.last + 1, right.first  # cues lo..hi-1 are in the gap
        if hi <= lo:
            continue
        # Switch from the left offset to the right offset where the speech map fits best.
        scores_l = np.cumsum([0.0] + [gain(i, left.offset) for i in range(lo, hi)])
        scores_r = np.cumsum([0.0] + [gain(i, right.offset) for i in range(lo, hi)])
        total_r = scores_r[-1]
        best_k = int(np.argmax(scores_l + (total_r - scores_r)))  # first best_k cues stay left
        for j, i in enumerate(range(lo, hi)):
            final[i] = left.offset if j < best_k else right.offset

    segments = []
    for r in merge_runs(find_runs(final, 1e-6), 1e-6):
        segments.append(
            {
                "from_cue": r.first + 1,
                "to_cue": r.last + 1,
                "cues": r.n,
                "start": round(spans[r.first][0], 2),
                "end": round(spans[r.last][1], 2),
                "extra_offset_seconds": round(r.offset, 3),
            }
        )
    return final, segments


# ============================ ffsubsync runner ============================

RE_PCT = re.compile(r"(\d{1,3})%\|")
RE_OFFSET = re.compile(r"offset seconds:\s*(-?[\d.]+)")
RE_SCALE = re.compile(r"framerate scale factor:\s*([\d.]+)")
RE_SCORE = re.compile(r"score:\s*(-?[\d.]+)")


def find_ffs() -> list[str]:
    exe = Path(sys.executable).parent / "ffs"
    if exe.exists():
        return [str(exe)]
    found = shutil.which("ffs")
    if found:
        return [found]
    return [sys.executable, "-m", "ffsubsync"]


def run_ffs(args: list[str], on_percent=None, timeout: float = 1800.0) -> dict:
    """Runs ffsubsync, reading its progress bar from stderr. Returns the numbers it logged."""
    proc = subprocess.Popen(
        find_ffs() + args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={**os.environ, "COLUMNS": "200"}
    )
    tail: list[str] = []
    info: dict = {}

    def pump():
        buf = b""
        while True:
            chunk = proc.stderr.read(256)
            if not chunk:
                break
            buf += chunk
            parts = re.split(rb"[\r\n]", buf)
            buf = parts.pop()
            for p in parts:
                line = p.decode("utf-8", "replace")
                if not line.strip():
                    continue
                tail.append(line)
                del tail[:-40]
                m = RE_PCT.search(line)
                if m and on_percent:
                    on_percent(min(100, int(m.group(1))))
                for key, rx in (("offset", RE_OFFSET), ("scale", RE_SCALE), ("score", RE_SCORE)):
                    m = rx.search(line)
                    if m:
                        info[key] = float(m.group(1))

    t = threading.Thread(target=pump, daemon=True)
    t.start()
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        raise SystemExit("ffsubsync took too long and was stopped")
    t.join(5)
    if proc.returncode != 0:
        raise SystemExit("ffsubsync failed:\n" + "\n".join(tail[-8:]))
    return info


def cache_key(media: Path) -> str:
    st = media.stat()
    return hashlib.sha1(f"{media.resolve()}|{st.st_size}|{int(st.st_mtime)}".encode()).hexdigest()[:16]


# ============================ main pipeline ============================


def fmt_time(s: float) -> str:
    s = int(round(s))
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}"


def sync(media: Path, sub_in: Path, sub_out: Path, cache_dir: Path, progress: Progress, piecewise: bool = True) -> dict:
    t_all = time.time()
    timings: dict[str, float] = {}
    progress.emit(1, "prepare", "Reading the subtitle")
    original = parse_srt(sub_in)
    work = Path(tempfile.mkdtemp(prefix="subsync_"))
    cache_dir.mkdir(parents=True, exist_ok=True)

    try:
        # ---- 1. speech map + global alignment (also fixes framerate drift) ----
        key = cache_key(media)
        npz = cache_dir / f"{key}.npz"
        cached = npz.exists()
        stage1 = work / "stage1.srt"
        t = time.time()
        if cached:
            progress.emit(5, "global", "Using the saved speech map")
            args = [str(npz), "-i", str(sub_in), "-o", str(stage1)]
            info1 = run_ffs(args)
        else:
            progress.emit(3, "audio", "Extracting audio and finding speech")
            link = cache_dir / f"{key}{media.suffix or '.media'}"
            if link.exists() or link.is_symlink():
                link.unlink()
            try:
                link.symlink_to(media.resolve())
            except OSError:
                shutil.copy(media, link)
            args = [str(link), "-i", str(sub_in), "-o", str(stage1), "--serialize-speech"]
            info1 = run_ffs(
                args, on_percent=lambda p: progress.emit(3 + p * 0.67, "audio", f"Extracting audio and finding speech ({p}%)")
            )
            produced = link.with_suffix(".npz")
            if produced != npz and produced.exists():
                produced.replace(npz)
            link.unlink(missing_ok=True)
        timings["global_pass"] = round(time.time() - t, 1)
        if not npz.exists():
            raise SystemExit("The speech map was not created (no speech found?)")
        speech = load_speech(npz)
        prefix = speech_prefix(speech)
        progress.emit(72, "global", "Matched the overall timing")

        global_cues = parse_srt(stage1)
        if len(global_cues) != len(original):
            raise SystemExit(f"Unexpected cue count after the global pass ({len(global_cues)} vs {len(original)})")
        spans0 = [(c.start.total_seconds(), c.end.total_seconds()) for c in original]
        spans1 = [(c.start.total_seconds(), c.end.total_seconds()) for c in global_cues]

        # ---- 2. piecewise candidates ----
        # A: piecewise on top of the global result (right for steady drift that the global pass fixed)
        # B: piecewise on the untouched input (right when the global pass mistook a step for a drift)
        # Each is cleaned up, scored on the speech map, and the best one wins.
        q_before = quality(prefix, spans0)
        q_global = quality(prefix, spans1)
        candidates: dict[str, dict] = {"global": {"spans": spans1, "segments": [], "quality": q_global}}
        t = time.time()
        if piecewise:
            scale = info1.get("scale") or 1.0
            plan = [("piecewise_after_global", stage1, spans1)]
            if abs(scale - 1.0) > FRAMERATE_EPS:
                plan.append(("piecewise_from_input", sub_in, spans0))
            done = threading.Event()
            state = {"p": 74.0, "msg": "Looking for places where the delay changes"}

            def tick():  # the piecewise pass reports no progress; show gentle movement
                while not done.wait(0.7):
                    state["p"] += (93 - state["p"]) * 0.06
                    progress.emit(state["p"], "split", state["msg"])

            progress.emit(74, "split", state["msg"])
            ticker = threading.Thread(target=tick, daemon=True)
            ticker.start()
            try:
                for name, src, base_spans in plan:
                    out2 = work / f"{name}.srt"
                    run_ffs(
                        [str(npz), "-i", str(src), "-o", str(out2), "--no-fix-framerate",
                         "--split-penalty", str(SPLIT_PENALTY), "--max-offset-seconds", str(MAX_OFFSET_SECONDS)]
                    )
                    split_cues = parse_srt(out2)
                    if len(split_cues) != len(original):
                        continue
                    deltas = [c.start.total_seconds() - bs for c, (bs, _) in zip(split_cues, base_spans)]
                    offsets, segs = clean_offsets(base_spans, deltas, prefix)
                    spans = [(bs + o, be + o) for (bs, be), o in zip(base_spans, offsets)]
                    candidates[name] = {"spans": spans, "segments": segs, "quality": quality(prefix, spans)}
            finally:
                done.set()
                ticker.join(2)
        timings["piecewise_pass"] = round(time.time() - t, 1)

        progress.emit(94, "check", "Checking the result")

        # ---- 3. pick the best candidate; keep it only if it is really better than the input ----
        best_name = "global"
        for name, c in candidates.items():
            if name != "global" and c["quality"] >= candidates[best_name]["quality"] + MIN_CANDIDATE_GAIN:
                best_name = name
        best = candidates[best_name]
        best_spans, best_q, segments = best["spans"], best["quality"], best["segments"]
        improved = best_q >= q_before + MIN_QUALITY_GAIN

        report = {
            "media": str(media),
            "subtitle_in": str(sub_in),
            "subtitle_out": str(sub_out) if improved else None,
            "cues": len(original),
            "speech_map_cached": cached,
            "global_pass": {
                "offset_seconds": info1.get("offset"),
                "framerate_scale": info1.get("scale"),
                "score": info1.get("score"),
            },
            "method_used": best_name if improved else None,
            "segments": segments,
            "candidates": {k: {"speech_overlap": round(v["quality"], 3), "segments": v["segments"]} for k, v in candidates.items()},
            "quality": {
                "speech_overlap_before": round(q_before, 3),
                "speech_overlap_global": round(q_global, 3),
                "speech_overlap_after": round(best_q, 3),
            },
            "improved": improved,
            "seconds": {**timings, "total": None},
        }

        if improved:
            out_cues = [
                srt.Subtitle(index=i + 1, start=timedelta(seconds=max(s, 0.0)), end=timedelta(seconds=max(e, 0.0)), content=c.content)
                for i, (c, (s, e)) in enumerate(zip(original, best_spans))
            ]
            write_srt(sub_out, out_cues)
            progress.emit(100, "done", "Subtitle synced")
        else:
            progress.emit(100, "done", "Couldn't sync this subtitle confidently - the original was kept")
        report["seconds"]["total"] = round(time.time() - t_all, 1)
        Path(str(sub_out) + ".report.json").write_text(json.dumps(report, indent=2))
        return report
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("media", type=Path, help="video or audio file (anything ffmpeg can read)")
    ap.add_argument("subtitle", type=Path, help="subtitle to fix (.srt)")
    ap.add_argument("-o", "--output", type=Path, required=True)
    ap.add_argument("--cache-dir", type=Path, default=Path(".sync_cache"))
    ap.add_argument("--progress-json", action="store_true", help="print progress as JSON lines")
    ap.add_argument("--global-only", action="store_true", help="skip the piecewise pass (constant offset + framerate only)")
    a = ap.parse_args()
    if not a.media.exists() or not a.subtitle.exists():
        raise SystemExit("media or subtitle file not found")
    report = sync(a.media, a.subtitle, a.output, a.cache_dir, Progress(a.progress_json), piecewise=not a.global_only)
    print(json.dumps({"result": report}, indent=None) if a.progress_json else json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
