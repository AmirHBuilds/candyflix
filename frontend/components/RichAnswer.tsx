"use client";

import { Fragment, useState, type ReactNode } from "react";

/**
 * The assistant's answer: short paragraphs, "- " bullets, **bold**, and ||spoilers|| that stay blurred
 * (like Telegram's spoiler) until tapped. Plain text only, never HTML. A spoiler the answer forgot to
 * close hides everything after it, which is the safe way round.
 */
function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  if (shown) return <span className="rounded bg-white/10 px-0.5">{children}</span>;
  return (
    <button
      type="button"
      data-spoiler="hidden"
      aria-label="Spoiler. Tap to reveal."
      onClick={() => setShown(true)}
      className="mx-px cursor-pointer select-none rounded bg-white/15 px-1 align-baseline text-inherit [text-shadow:0_0_9px_rgba(255,255,255,0.85)] blur-[5px] transition hover:bg-white/25 motion-safe:animate-pulse"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

function bold(text: string, keyBase: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={`${keyBase}-b${i}`} className="font-semibold text-white">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={`${keyBase}-t${i}`}>{part}</Fragment>
    ),
  );
}

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pieces = text.split("||");
  // Even pieces are outside bars, odd ones inside; an odd count of bars leaves the last piece open (= spoiler).
  pieces.forEach((piece, i) => {
    if (!piece) return;
    if (i % 2 === 0) out.push(...bold(piece, `${keyBase}-${i}`));
    else out.push(<Spoiler key={`${keyBase}-s${i}`}>{bold(piece, `${keyBase}-${i}`)}</Spoiler>);
  });
  return out;
}

export default function RichAnswer({ text }: { text: string }) {
  const blocks: { kind: "p" | "li"; text: string }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^(?:[-•*]\s+)(.*)$/);
    blocks.push(bullet ? { kind: "li", text: bullet[1] } : { kind: "p", text: line });
  }
  // A spoiler can run across lines: carry an open bar into the next block.
  let open = false;
  const normalised = blocks.map((b) => {
    const t = (open ? "||" : "") + b.text;
    const bars = (t.match(/\|\|/g) ?? []).length;
    open = bars % 2 === 1;
    return { ...b, text: open ? t + "||" : t };
  });

  const nodes: ReactNode[] = [];
  let items: ReactNode[] = [];
  const flush = (key: string) => {
    if (items.length) nodes.push(<ul key={key} className="ml-4 list-disc space-y-1">{items}</ul>);
    items = [];
  };
  normalised.forEach((b, i) => {
    if (b.kind === "li") items.push(<li key={i}>{inline(b.text, `l${i}`)}</li>);
    else {
      flush(`ul${i}`);
      nodes.push(<p key={i}>{inline(b.text, `p${i}`)}</p>);
    }
  });
  flush("ul-end");
  return <div className="space-y-2 text-sm leading-relaxed text-white/90">{nodes}</div>;
}
