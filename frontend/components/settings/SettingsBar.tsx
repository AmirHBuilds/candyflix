"use client";

import { useEffect, useRef, useState } from "react";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "@/lib/settings-sections";

/**
 * Full-width section bar for the one long settings page. It sticks under
 * the site header, highlights the section being read, and jumps to a
 * section when tapped.
 */
export default function SettingsBar() {
  const [active, setActive] = useState<SettingsSectionId>(SETTINGS_SECTIONS[0].id);
  const [top, setTop] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);

  // Stick just below the site header, whatever its height is (the search
  // row makes it taller on some pages).
  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const measure = () => setTop(Math.round(header.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  // The active section is the last one whose top has scrolled past a line
  // just under the bars.
  useEffect(() => {
    const update = () => {
      const line = top + (barRef.current?.offsetHeight ?? 0) + 24;
      let current: SettingsSectionId = SETTINGS_SECTIONS[0].id;
      for (const s of SETTINGS_SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= line) current = s.id;
      }
      // At the very bottom the last section wins even if it is short.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        current = SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1].id;
      }
      setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [top]);

  function jump(id: SettingsSectionId) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      window.history.replaceState(null, "", `#${id}`);
    } catch {
      /* the hash is only a convenience */
    }
    setActive(id);
  }

  return (
    <div
      ref={barRef}
      style={{ top }}
      className="sticky z-10 -mx-6 border-b border-white/10 bg-canvas/95 px-6 backdrop-blur sm:-mx-10 sm:px-10"
    >
      <nav aria-label="Settings sections">
        <ul className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
          {SETTINGS_SECTIONS.map((s) => (
            <li key={s.id} className="shrink-0">
              <button
                type="button"
                onClick={() => jump(s.id)}
                aria-current={active === s.id ? "true" : undefined}
                className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                  active === s.id ? "bg-accent/15 text-accent" : "text-white/60 hover:bg-white/5 hover:text-white"
                }`}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
