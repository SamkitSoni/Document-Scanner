'use client';

import { useEffect, useState } from 'react';
import { documentTypeLabel, statusLabel } from '@/lib/display';
import { DOCUMENT_STATUSES, DOCUMENT_TYPES } from '@/lib/types';

export interface FilterValues {
  status: string[];
  documentType: string[];
  search: string;
  from: string;
  to: string;
}

/**
 * Filter controls. All state is owned by the page and mirrored into the URL, so
 * this component stays a pure input surface — a filtered view is shareable and
 * survives a refresh.
 */
export function Filters({
  values,
  onChange,
  onReset,
}: {
  values: FilterValues;
  onChange: (next: Partial<FilterValues>) => void;
  onReset: () => void;
}) {
  // The search box is debounced locally so typing does not fire a request per
  // keystroke, while the URL still ends up holding the committed value.
  const [search, setSearch] = useState(values.search);

  useEffect(() => {
    setSearch(values.search);
  }, [values.search]);

  useEffect(() => {
    if (search === values.search) return;
    const timer = setTimeout(() => onChange({ search }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function toggle(key: 'status' | 'documentType', value: string) {
    const current = values[key];
    onChange({
      [key]: current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    });
  }

  const active =
    values.status.length > 0 ||
    values.documentType.length > 0 ||
    values.search !== '' ||
    values.from !== '' ||
    values.to !== '';

  return (
    <div className="card space-y-4 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <label htmlFor="search" className="label">
            Search filenames
          </label>
          <input
            id="search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="e.g. acme"
            className="field"
          />
        </div>

        <div>
          <label htmlFor="from" className="label">
            Uploaded from
          </label>
          <input
            id="from"
            type="date"
            value={values.from}
            onChange={(event) => onChange({ from: event.target.value })}
            className="field"
          />
        </div>

        <div>
          <label htmlFor="to" className="label">
            Uploaded to
          </label>
          <input
            id="to"
            type="date"
            value={values.to}
            onChange={(event) => onChange({ to: event.target.value })}
            className="field"
          />
        </div>

        {active && (
          <button type="button" onClick={onReset} className="btn-secondary">
            Clear filters
          </button>
        )}
      </div>

      <FilterGroup
        legend="Status"
        options={DOCUMENT_STATUSES.map((value) => ({ value, label: statusLabel(value) }))}
        selected={values.status}
        onToggle={(value) => toggle('status', value)}
      />

      <FilterGroup
        legend="Document type"
        options={DOCUMENT_TYPES.map((value) => ({ value, label: documentTypeLabel(value) }))}
        selected={values.documentType}
        onToggle={(value) => toggle('documentType', value)}
      />
    </div>
  );
}

/**
 * Toggle chips backed by real checkboxes: they are multi-select, and a
 * checkbox is what a screen reader should announce.
 */
function FilterGroup({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = selected.includes(option.value);
          return (
            <label
              key={option.value}
              className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-within:ring-2 focus-within:ring-accent ${
                checked
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line text-muted hover:border-accent/40 hover:text-ink'
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() => onToggle(option.value)}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
