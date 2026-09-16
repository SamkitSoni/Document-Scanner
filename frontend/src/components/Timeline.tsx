'use client';

import { Icon } from '@/components/Icon';
import { STATUS_PRESENTATION, formatTime, statusLabel } from '@/lib/display';
import type { DocumentStatus, HistoryEvent } from '@/lib/types';

/**
 * The processing history as a vertical timeline.
 *
 * This is the §8C requirement — "show the processing lifecycle in a
 * user-friendly manner" — and it reads as a story rather than a table:
 * uploaded, attempted, failed with a reason, retried, processed. The event log
 * is append-only on the backend, so this is a faithful record, not a
 * reconstruction.
 */
export function Timeline({ events, live = false }: { events: HistoryEvent[]; live?: boolean }) {
  if (events.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
        No processing events recorded yet.
      </p>
    );
  }

  return (
    <ol className="relative">
      {events.map((event, index) => {
        const last = index === events.length - 1;
        // A MANUAL_RETRY event is written as UPLOADED with a reason; naming it
        // explicitly is what makes the retry visible in the story.
        const manual = event.reason === 'MANUAL_RETRY';

        return (
          <li key={`${event.timestamp}-${index}`} className="relative flex gap-3.5 pb-5 last:pb-0">
            {/* The connector, drawn between markers rather than under the last. */}
            {!last && (
              <span aria-hidden className="absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-px bg-line" />
            )}

            <Marker status={event.status} manual={manual} active={last && live} />

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-sm font-semibold text-ink">
                  {manual ? 'Manual retry requested' : statusLabel(event.status)}
                </p>
                <time
                  dateTime={event.timestamp}
                  className="ml-auto text-[11px] tabular-nums text-muted"
                >
                  {formatTime(event.timestamp)}
                </time>
              </div>

              {event.attempt !== null && (
                <span className="mt-1.5 inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-muted ring-1 ring-inset ring-line">
                  Attempt {event.attempt}
                </span>
              )}

              {event.reason && !manual && (
                <p className="mt-1 font-mono text-[11px] text-muted">{event.reason}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Shape carries meaning alongside colour, via the same icon as the badge.
 *
 * `active` is what stops a finished document spinning forever: the timeline is a
 * historical log, so every processed document still contains a past PROCESSING
 * event. Animating on status alone made that old entry spin for good. Only the
 * last event, and only while the document is genuinely still in flight, moves.
 */
function Marker({
  status,
  manual,
  active,
}: {
  status: DocumentStatus;
  manual: boolean;
  active: boolean;
}) {
  const presentation = STATUS_PRESENTATION[status];
  const processing = status === 'PROCESSING' && active;

  return (
    <span
      aria-hidden
      className={`relative z-10 grid h-[27px] w-[27px] shrink-0 place-items-center rounded-full ring-4 ring-surface ${presentation.solid}`}
    >
      <Icon
        name={manual ? 'retry' : presentation.icon}
        size={14}
        className={processing ? 'animate-spin' : ''}
      />
    </span>
  );
}
