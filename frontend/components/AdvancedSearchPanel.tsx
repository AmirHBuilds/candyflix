"use client";

import { useState } from "react";
import type { DiscoverFilters, Genre, SortOption } from "@/lib/media";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 1969 }, (_, i) => CURRENT_YEAR - i);

const SORT_LABELS: Record<SortOption, string> = {
  popularity: "Most Popular",
  rating: "Top Rated",
  newest: "Newest",
};

const RATING_OPTIONS: { value: number | undefined; label: string }[] = [
  { value: undefined, label: "Any rating" },
  { value: 6, label: "6+" },
  { value: 7, label: "7+" },
  { value: 8, label: "8+" },
  { value: 9, label: "9+" },
];

const selectClass =
  "w-full appearance-none rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm text-white outline-none focus:border-[#FF5FA2]/60";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-white/40">{label}</span>
      {children}
    </label>
  );
}

export default function AdvancedSearchPanel({
  genres,
  onApply,
  onClear,
  hasActiveFilters,
}: {
  genres: Genre[];
  onApply: (filters: DiscoverFilters) => void;
  onClear: () => void;
  hasActiveFilters: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [genre, setGenre] = useState<string>("");
  const [year, setYear] = useState<string>("");
  const [sort, setSort] = useState<SortOption>("popularity");
  const [minRating, setMinRating] = useState<string>("");

  function handleApply() {
    onApply({
      genre: genre ? Number(genre) : undefined,
      year: year ? Number(year) : undefined,
      sort,
      minRating: minRating ? Number(minRating) : undefined,
    });
  }

  function handleClear() {
    setGenre("");
    setYear("");
    setSort("popularity");
    setMinRating("");
    onClear();
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-white/90">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className="text-[#C9A6FF]"
            aria-hidden="true"
          >
            <path
              d="M2 4h12M4.5 8h7M7 12h2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          Advanced Search
          {hasActiveFilters && (
            <span className="rounded-full bg-[#FF5FA2]/20 px-2 py-0.5 text-xs font-medium text-[#FF5FA2]">
              Active
            </span>
          )}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className={`text-white/40 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path
            d="M3 5l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="border-t border-white/10 px-5 py-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Genre">
              <select className={selectClass} value={genre} onChange={(e) => setGenre(e.target.value)}>
                <option value="">Any genre</option>
                {genres.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Year">
              <select className={selectClass} value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="">Any year</option>
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Sort by">
              <select
                className={selectClass}
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
              >
                {(Object.keys(SORT_LABELS) as SortOption[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Min rating">
              <select
                className={selectClass}
                value={minRating}
                onChange={(e) => setMinRating(e.target.value)}
              >
                {RATING_OPTIONS.map((opt) => (
                  <option key={opt.label} value={opt.value ?? ""}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={handleApply}
              className="rounded-xl bg-[#FF5FA2] px-5 py-2.5 text-sm font-medium text-[#0b0b12] hover:bg-[#FF5FA2]/90"
            >
              Search
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-medium text-white/70 hover:bg-white/5"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
