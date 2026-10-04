"use client";

import { useState } from "react";
import OverviewTab from "@/components/admin/OverviewTab";
import SystemTab from "@/components/admin/SystemTab";
import UsersTab from "@/components/admin/UsersTab";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "system", label: "System" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function AdminPanel({ currentUserId }: { currentUserId: string }) {
  const [tab, setTab] = useState<TabId>("overview");
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
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.id ? "bg-accent/15 text-accent" : "text-white/60 hover:bg-white/5 hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`admin-panel-${tab}`} aria-labelledby={`admin-tab-${tab}`}>
        {tab === "overview" && <OverviewTab />}
        {tab === "users" && <UsersTab currentUserId={currentUserId} />}
        {tab === "system" && <SystemTab />}
      </div>
    </div>
  );
}
