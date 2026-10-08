"use client";

import { useState } from "react";
import { DayView, SignInsView, TitleViewersView, TitlesView } from "@/components/admin/DrillViews";
import AITab from "@/components/admin/AITab";
import BannersTab from "@/components/admin/BannersTab";
import FooterTab from "@/components/admin/FooterTab";
import LogTab from "@/components/admin/LogTab";
import MessagesTab from "@/components/admin/MessagesTab";
import OverviewTab, { type OverviewDrill } from "@/components/admin/OverviewTab";
import SystemTab from "@/components/admin/SystemTab";
import UserDetailView from "@/components/admin/UserDetailView";
import UsersTab, { FILTER_TITLES } from "@/components/admin/UsersTab";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "messages", label: "Messages" },
  { id: "log", label: "Log" },
  { id: "ai", label: "AI" },
  { id: "banners", label: "Banners" },
  { id: "footer", label: "Footer" },
  { id: "system", label: "System" },
] as const;

type TabId = (typeof TABS)[number]["id"];
type Drill = OverviewDrill | { kind: "person"; id: string };

function labelOf(d: Drill | undefined, base: string): string {
  if (!d) return base;
  switch (d.kind) {
    case "users":
      return d.filter ? FILTER_TITLES[d.filter] : "People";
    case "titles":
      return "Everything watched";
    case "title":
      return d.name;
    case "day":
      return "That day";
    case "signins":
      return "Sign-ins";
    case "person":
      return "Person";
  }
}

export default function AdminPanel({ currentUserId }: { currentUserId: string }) {
  const [tab, setTab] = useState<TabId>("overview");
  // Drill-downs stack on top of the tab; "back" pops one level.
  const [stack, setStack] = useState<Drill[]>([]);
  const push = (d: Drill) => setStack((s) => [...s, d]);
  const pop = () => setStack((s) => s.slice(0, -1));
  const baseLabel = tab === "users" ? "People" : "Overview";
  const current = stack.at(-1);
  const backLabel = labelOf(stack.at(-2), baseLabel);
  const toPerson = (id: string) => push({ kind: "person", id });

  function renderDrill(d: Drill) {
    switch (d.kind) {
      case "users":
        return <UsersTab key={d.filter ?? "all"} currentUserId={currentUserId} filter={d.filter} onView={toPerson} onBack={pop} backLabel={backLabel} />;
      case "person":
        return <UserDetailView key={d.id} userId={d.id} onBack={pop} backLabel={backLabel} />;
      case "titles":
        return <TitlesView onBack={pop} onOpen={(t) => push({ kind: "title", mediaType: t.media_type, tmdbId: t.tmdb_id, name: t.title ?? `${t.media_type === "tv" ? "Show" : "Movie"} #${t.tmdb_id}` })} />;
      case "title":
        return <TitleViewersView mediaType={d.mediaType} tmdbId={d.tmdbId} name={d.name} onBack={pop} backLabel={backLabel} onPerson={toPerson} />;
      case "day":
        return <DayView day={d.date} onBack={pop} onPerson={toPerson} />;
      case "signins":
        return <SignInsView onBack={pop} onPerson={toPerson} />;
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold text-white">Admin panel</h1>
      <div role="tablist" aria-label="Admin sections" className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`admin-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`admin-panel-${t.id}`}
            onClick={() => {
              setTab(t.id);
              setStack([]);
            }}
            className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.id ? "bg-accent/15 text-accent" : "text-white/60 hover:bg-white/5 hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`admin-panel-${tab}`} aria-labelledby={`admin-tab-${tab}`}>
        {current ? (
          renderDrill(current)
        ) : (
          <>
            {tab === "overview" && <OverviewTab onDrill={push} />}
            {tab === "users" && <UsersTab currentUserId={currentUserId} onView={toPerson} />}
            {tab === "messages" && <MessagesTab />}
            {tab === "log" && <LogTab />}
            {tab === "ai" && <AITab onViewPerson={toPerson} />}
            {tab === "banners" && <BannersTab />}
            {tab === "footer" && <FooterTab />}
            {tab === "system" && <SystemTab />}
          </>
        )}
      </div>
    </div>
  );
}
