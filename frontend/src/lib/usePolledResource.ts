'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

interface Options<T> {
  /**
   * How often to refetch, in ms. Return `null` to stop polling — the hook calls
   * this with the latest data, so a screen stops refreshing once every document
   * it is showing has reached a terminal state.
   */
  intervalMs: (data: T | null) => number | null;
  /** Re-runs the fetch when any of these change. */
  deps: unknown[];
}

interface State<T> {
  data: T | null;
  error: string | null;
  /** True only for the first load, so refreshes do not flash a skeleton. */
  loading: boolean;
  /** True while a background refresh is in flight. */
  refreshing: boolean;
  refresh: () => void;
}

/**
 * Fetch, then keep fetching while there is something in flight.
 *
 * Polling is the deliberate simplification here — server-sent events would be
 * the production answer, and that tradeoff is recorded in the README. What this
 * hook does guarantee is that polling *stops*: once `intervalMs` returns null,
 * no further timer is scheduled.
 */
export function usePolledResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  { intervalMs, deps }: Options<T>,
): State<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Held in a ref so the polling effect does not re-subscribe on every render
  // just because the caller passed a new closure.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const intervalRef = useRef(intervalMs);
  intervalRef.current = intervalMs;

  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    async function run(isFirst: boolean) {
      if (!isFirst) setRefreshing(true);

      try {
        const result = await fetcherRef.current(controller.signal);
        if (cancelled) return;

        setData(result);
        setError(null);

        const next = intervalRef.current(result);
        if (next !== null) timer = setTimeout(() => void run(false), next);
      } catch (cause) {
        if (cancelled || (cause instanceof DOMException && cause.name === 'AbortError')) return;

        // ApiError messages are already safe to render; anything else is
        // reported generically rather than leaking an internal string.
        setError(
          cause instanceof ApiError ? cause.message : 'Something went wrong. Please try again.',
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    setLoading(true);
    void run(true);

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, error, loading, refreshing, refresh };
}
