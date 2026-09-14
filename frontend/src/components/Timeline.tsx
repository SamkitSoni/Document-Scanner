'use client';

import { STATUS_PRESENTATION, failureReasonLabel, formatTime, statusLabel } from '@/lib/display';
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
export function Timeline({ events }: { events: HistoryEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted">No processing events recorded yet.</p>;
  }

  return (
    <ol className="relative space-y-0">
      {events.map((event, index) => {
        const last = index === events.length - 1;
        const reason = failureReasonLabel(event.reason);
        // A MANUAL_RETRY event is written as UPLOADED with a reason; naming it
        // explicitly is what makes the retry visible in the story.
        const manual = event.reason === 'MANUAL_RETRY';

        return (
          <li key={`${event.timestamp}-${index}`} className="relative flex gap-4 pb-6 last:pb-0">
            {/* The connector, drawn between markers rather than under the last one. */}
            {!last && (
              <span
                aria-hidden
                className="absolute left-[11px] top-6 h-full w-px bg-line"
              />
            )}

            <Marker status={event.status} manual={manual} />

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-sm font-medium text-ink">
                  {manual ? 'Manual retry requested' : statusLabel(event.status)}
                </p>
                {event.attempt !== null && (
                  <span className="rounded bg-canvas px-1.5 py-0.5 text-xs text-muted">
                    attempt {event.attempt}
                  </span>
                )}
                <time dateTime={event.timestamp} className="text-xs tabular-nums text-muted">
                  {formatTime(event.timestamp)}
                </time>
              </div>

              {reason && !manual && <p className="mt-1 text-sm text-muted">{reason}</p>}

              {event.reason && !manual && (
                <p className="mt-0.5 font-mono text-xs text-muted/80">{event.reason}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Shape carries meaning alongside colour: ✓ done, ✕ failed, ↻ retrying. */
function Marker({ status, manual }: { status: DocumentStatus; manual: boolean }) {
  const presentation = STATUS_PRESENTATION[status];

  let glyph = '•';
  if (manual) glyph = '↻';
  else if (status === 'PROCESSED') glyph = '✓';
  else if (status === 'FAILED' || status === 'VALIDATION_FAILED') glyph = '✕';
  else if (status === 'RETRY_PENDING') glyph = '↻';

  return (
    <span
      aria-hidden
      className={`relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white ${presentation.dot} ${
        status === 'PROCESSING' ? 'animate-pulse' : ''
      }`}
    >
      {glyph}
    </span>
  );
}
