"use client";

import { useId } from "react";

// Building blocks shared by every settings page, so they all look and
// behave the same (and are tested once).

export function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="animate-fade-up rounded-2xl border border-white/10 bg-white/[0.03]">
      <header className="border-b border-white/10 px-5 py-4">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-white/50">{description}</p>}
      </header>
      <div className="divide-y divide-white/10">{children}</div>
    </section>
  );
}

/** One setting: a label and explanation on the left, its control on the right (below on phones). */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 sm:max-w-md">
        <label htmlFor={htmlFor} className="text-sm font-medium text-white">
          {label}
        </label>
        {description && <p className="mt-0.5 text-sm text-white/50">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  id,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "bg-accent" : "bg-white/20"
      }`}
    >
      <span
        className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-white transition-transform ${
          checked ? "translate-x-5" : ""
        }`}
      />
    </button>
  );
}

/** A row of mutually exclusive choices (a radio group that looks like buttons). */
export function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-xl bg-white/[0.06] p-1">
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            name={name}
            aria-checked={selected}
            onClick={() => !selected && onChange(opt.value)}
            className={`h-9 min-w-12 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
              selected ? "bg-accent text-on-accent" : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Shown on sections whose options haven't shipped yet. */
export function ComingSoon({ title, items }: { title: string; items: string[] }) {
  return (
    <SettingsCard title={title} description="These options are coming in an upcoming update.">
      <ul className="space-y-2 px-5 py-4 text-sm text-white/60">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden="true" className="text-accent">
              •
            </span>
            {item}
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
