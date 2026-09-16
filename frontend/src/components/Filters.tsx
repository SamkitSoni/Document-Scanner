'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
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

  const activeCount =
    values.status.length +
    values.documentType.length +
    (values.search ? 1 : 0) +
    (values.from ? 1 : 0) +
    (values.to ? 1 : 0);

  // The chip rows start open when a filter is already applied — arriving from a
  // dashboard tile should show *why* the list is filtered, not hide it.
  const [open, setOpen] = useState(
    values.status.length > 0 || values.documentType.length > 0,
  );

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[13rem] flex-1">
          <label htmlFor="search" className="label">
            Search filenames
          </label>
          <div className="relative">
            <Icon
              name="search"
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              id="search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="e.g. acme"
              className="field pl-9"
            />
          </div>
        </div>

        {/* The two dates are one control conceptually, so they wrap together
            rather than leaving "To" orphaned on its own line. */}
        <div className="flex flex-1 gap-3 sm:flex-none">
          <div className="min-w-0 flex-1 sm:flex-none">
            <label htmlFor="from" className="label">
              From
            </label>
            <input
              id="from"
              type="date"
              value={values.from}
              onChange={(event) => onChange({ from: event.target.value })}
              className="field"
            />
          </div>

          <div className="min-w-0 flex-1 sm:flex-none">
            <label htmlFor="to" className="label">
              To
            </label>
            <input
              id="to"
              type="date"
              value={values.to}
              onChange={(event) => onChange({ to: event.target.value })}
              className="field"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls="filter-chips"
          className="btn-secondary"
        >
          <Icon name="filter" size={15} />
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-ink">
              {activeCount}
            </span>
          )}
          <Icon
            name="chevron-down"
            size={14}
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {activeCount > 0 && (
          <button type="button" onClick={onReset} className="btn-ghost">
            <Icon name="close" size={14} />
            Clear
          </button>
        )}
      </div>

      {open && (
        <div
          id="filter-chips"
          className="animate-fade-in space-y-4 border-t border-line bg-surface-2 p-4"
        >
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
      )}
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
      <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = selected.includes(option.value);
          return (
            <label
              key={option.value}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all focus-within:ring-2 focus-within:ring-accent/50 ${
                checked
                  ? 'border-accent bg-accent text-accent-ink shadow-sm'
                  : 'border-line bg-surface text-muted hover:border-accent/40 hover:text-ink'
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() => onToggle(option.value)}
              />
              {checked && <Icon name="check" size={12} />}
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
