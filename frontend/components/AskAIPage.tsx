"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AskResultRow from "@/components/AskResultRow";
import { useBoxName } from "@/components/BoxNameProvider";
import { useSettings } from "@/components/SettingsProvider";
import { SparkleIcon } from "@/components/NavSearch";
import { LoadingRegion, Skeleton } from "@/components/Skeleton";
import { askAI, getAIStatus, type AIStatus, type AskResponse } from "@/lib/ai";

type View = { state: "idle" } | { state: "loading" } | { state: "error"; message: string } | { state: "done"; data: AskResponse };
type Tab = "for_you" | "general";

export default function AskAIPage() {
  const router = useRouter();
  const q = (useSearchParams().get("q") ?? "").trim();
  const [text, setText] = useState(q);
  const [view, setView] = useState<View>({ state: "idle" });
  const [tab, setTab] = useState<Tab>("for_you");
  const [status, setStatus] = useState<AIStatus | null>(null);
  const run = useRef(0);
  const boxName = useBoxName();
  const usesHistory = useSettings().settings.ai.use_history;

  useEffect(() => setText(q), [q]);

  // Opening the page with a request in the address (from the search box) asks straight away. Asking the
  // same thing again within the hour is free on the server, so a refresh doesn't use up a search.
  useEffect(() => {
    getAIStatus().then(setStatus);
  }, []);
  useEffect(() => {
    if (q.length < 3) {
      setView({ state: "idle" });
      return;
    }
    const mine = ++run.current;
    setView({ state: "loading" });
    askAI(q)
      .then((data) => {
        if (mine !== run.current) return;
        setTab(data.for_you.length > 0 ? "for_you" : "general");
        setView({ state: "done", data });
        getAIStatus().then(setStatus);
      })
      .catch((e) => mine === run.current && setView({ state: "error", message: e instanceof Error ? e.message : "The AI couldn't answer right now." }));
  }, [q]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (t.length < 3) return;
    router.push(`/ask?q=${encodeURIComponent(t)}`);
  }

  const left = view.state === "done" ? view.data.remaining : (status?.remaining ?? null);
  const unlimited = status ? status.limit === null : view.state === "done" && view.data.limit === null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="flex items-center gap-2.5 font-[family-name:var(--font-display)] text-2xl font-semibold text-white">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-accent text-on-accent">
            <SparkleIcon />
          </span>
          Ask AI
        </h1>
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={400}
            aria-label="What do you feel like watching?"
            placeholder="e.g. I'm sad, I want a sad movie about a lonely girl"
            className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-white placeholder-white/30 outline-none focus:border-accent/60"
          />
          <button
            type="submit"
            disabled={text.trim().length < 3 || view.state === "loading"}
            className="h-12 shrink-0 rounded-xl bg-accent px-6 font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Ask
          </button>
        </form>
        <p className="text-xs text-white/40">
          {usesHistory ? (
            <>
              Uses what you recently watched and what&apos;s in {boxName} for better picks.{" "}
              <Link href="/settings" className="underline decoration-white/20 underline-offset-2 hover:text-white/70">
                Change
              </Link>
            </>
          ) : (
            "Not using your watch history. You can turn that on in Settings."
          )}
        </p>
        {!unlimited && left !== null && view.state !== "error" && (
          <p className="text-xs text-white/40">
            {left === 0 ? "No AI searches left today. They come back tomorrow." : `${left} AI ${left === 1 ? "search" : "searches"} left today`}
          </p>
        )}
      </header>

      {view.state === "idle" && <p className="text-white/50">Tell me a mood, a feeling or a kind of story, and I&apos;ll suggest what to watch.</p>}

      {view.state === "loading" && (
        <LoadingRegion className="flex flex-col gap-4">
          <p role="status" className="text-sm text-white/60">
            Asking the AI… this can take a few seconds.
          </p>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 w-full rounded-2xl" />
          ))}
        </LoadingRegion>
      )}

      {view.state === "error" && (
        <div role="alert" className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <p className="text-white/80">{view.message}</p>
          <p className="mt-2 text-sm text-white/50">
            You can also <Link href={`/search?q=${encodeURIComponent(q)}`} className="text-accent hover:underline">search for “{q}” the usual way</Link>.
          </p>
        </div>
      )}

      {view.state === "done" && <Results data={view.data} tab={tab} setTab={setTab} />}
    </div>
  );
}

function Results({ data, tab, setTab }: { data: AskResponse; tab: Tab; setTab: (t: Tab) => void }) {
  const both = data.for_you.length > 0 && data.general.length > 0;
  const shown = tab === "for_you" && data.for_you.length > 0 ? data.for_you : data.general.length > 0 ? data.general : data.for_you;
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "for_you", label: "For you", count: data.for_you.length },
    { id: "general", label: "Anything like this", count: data.general.length },
  ];
  return (
    <div className="flex flex-col gap-4">
      {data.note && (
        <p className="rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm leading-relaxed text-white/80">
          <span aria-hidden>✨ </span>
          {data.note}
        </p>
      )}
      {both && (
        <div role="tablist" aria-label="Suggestions" className="flex gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${tab === t.id ? "bg-accent text-on-accent" : "bg-white/10 text-white/70 hover:bg-white/15"}`}
            >
              {t.label} <span className={tab === t.id ? "text-on-accent/70" : "text-white/40"}>{t.count}</span>
            </button>
          ))}
        </div>
      )}
      <div role="tabpanel" className="flex flex-col gap-3">
        {shown.map((item) => (
          <AskResultRow key={`${item.media_type}-${item.tmdb_id}`} item={item} />
        ))}
      </div>
    </div>
  );
}
