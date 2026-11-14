"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";

/** One-shot async loader with loading/error state and a reload() that re-runs it. */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[], enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(enabled);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fnRef.current().then(
      (v) => { if (!cancelled) { setData(v); setLoading(false); } },
      (e: unknown) => { if (!cancelled) { setError(e); setData(null); setLoading(false); } },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tick, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

interface PollOptions<T> {
  /** Polling restarts when this changes. */
  id: string;
  initial: T | null;
  fetch: () => Promise<T>;
  /** Keep polling while this returns true. */
  keepGoing: (v: T) => boolean;
  intervalMs: number;
}

/**
 * Polls `fetch` until `keepGoing` is false. Tolerates two transient failures in a row; on the third (or any
 * 4xx), stops and exposes the error. `retry()` restarts polling.
 */
export function usePolling<T>(o: PollOptions<T>) {
  const [data, setData] = useState<T | null>(o.initial);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const optsRef = useRef(o);
  optsRef.current = o;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const { initial, intervalMs, keepGoing } = optsRef.current;
    if (initial && !keepGoing(initial)) return;

    const tick = async () => {
      try {
        const v = await optsRef.current.fetch();
        if (cancelled) return;
        failures = 0;
        setData(v);
        setError(null);
        if (optsRef.current.keepGoing(v)) timer = setTimeout(tick, intervalMs);
      } catch (e) {
        if (cancelled) return;
        failures += 1;
        const fatal = e instanceof ApiError && e.status >= 400 && e.status < 500;
        if (fatal || failures >= 3) { setError(e); return; }
        timer = setTimeout(tick, intervalMs * 2);
      }
    };
    timer = setTimeout(tick, initial ? intervalMs : 0);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [o.id, attempt]);

  const retry = useCallback(() => { setError(null); setAttempt((a) => a + 1); }, []);
  return { data, error, retry, setData };
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
