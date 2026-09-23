/**
 * Round store — backed by the FastAPI service.
 *
 * The tape, the settings, the prediction ledger and the alert history all live
 * server-side in SQLite. Live rounds arrive over a WebSocket; the local React
 * state is a cache of what the backend already committed, never the source of
 * truth. Browser storage is not used anywhere.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  api,
  openRoundSocket,
  type AlertEventRow,
  type ApiRound,
  type LiveContext,
  type LiveMessage,
  type PredictionEntry,
  type Settings,
} from "./api";
import { createContextHook } from "./create-context-hook";
import type { Round } from "./pipeline";

const MAX_ROUNDS = 2400;

type ConnState = "connecting" | "open" | "closed";

function toRound(r: ApiRound): Round {
  return { id: r.id, ts: r.ts, m: r.m, band: (r.band ?? undefined) as Round["band"] };
}

export const [RoundProvider, useRounds] = createContextHook(() => {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastAddedAt, setLastAddedAt] = useState(0);
  const [isLive, setIsLiveState] = useState(false);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [context, setContext] = useState<LiveContext | null>(null);
  const [openPrediction, setOpenPrediction] = useState<PredictionEntry | null>(null);
  const [alertFeed, setAlertFeed] = useState<AlertEventRow[]>([]);
  const [total, setTotal] = useState(0);
  const mounted = useRef(true);
  const newestRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const [meta, tape] = await Promise.all([
        api.get<{ settings: Settings; rounds: number }>("/meta"),
        api.get<{ rounds: ApiRound[]; total: number }>("/rounds?limit=2400"),
      ]);
      if (!mounted.current) return;
      setSettings(meta.settings);
      setRounds(tape.rounds.map(toRound));
      setTotal(tape.total);
      // lastAddedAt is the "the tape moved" signal the ledger and the engines key
      // off. It used to be set only by a websocket push, so whenever the preview
      // proxy dropped frames and the poll fallback took over, the tape grew while
      // everything watching this signal stayed frozen on stale figures.
      const newest = tape.rounds.length ? tape.rounds[tape.rounds.length - 1].id : 0;
      if (newest !== newestRef.current) {
        newestRef.current = newest;
        setLastAddedAt(Date.now());
      }
      setError(null);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "backend unreachable");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    api.get<LiveContext>("/context").then(setContext).catch(() => undefined);
    api.get<{ running: boolean }>("/sim/status").then((s) => setIsLiveState(s.running)).catch(() => undefined);
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  // live push
  useEffect(() => {
    const stop = openRoundSocket((msg: LiveMessage) => {
      if (msg.type === "round") {
        setRounds((prev) => [...prev, toRound(msg.round)].slice(-MAX_ROUNDS));
        newestRef.current = msg.round.id;
        setTotal((n) => n + 1);
        setContext(msg.context);
        setOpenPrediction(msg.locked);
        setLastAddedAt(Date.now());
        if (msg.alerts?.length) setAlertFeed((prev) => [...msg.alerts, ...prev].slice(0, 40));
      } else if (msg.type === "bulk") {
        setTotal(msg.total);
        void refresh();
      }
    }, setConn);
    return stop;
  }, [refresh]);

  // Live fallback. The hosted preview proxies plain HTTP reliably but websocket
  // frames can be dropped by the proxy, which would leave the tape silently
  // stale while the generator keeps producing rounds. Whenever the feed is
  // running we also poll the backend, so pushes are a latency win rather than a
  // correctness requirement.
  useEffect(() => {
    if (!isLive) return;
    const ms = Math.max(2000, settings?.liveFeedIntervalMs ?? 2500);
    const id = setInterval(() => {
      void refresh();
      api.get<LiveContext>("/context").then(setContext).catch(() => undefined);
    }, ms);
    return () => clearInterval(id);
  }, [isLive, refresh, settings?.liveFeedIntervalMs]);

  const setIsLive = useCallback(async (next: boolean) => {
    setIsLiveState(next);
    try {
      if (next) {
        const ms = settings?.liveFeedIntervalMs ?? 2500;
        await api.post(`/sim/start?intervalMs=${ms}`);
      } else {
        await api.post("/sim/stop");
      }
    } catch (e) {
      setIsLiveState(!next);
      setError(e instanceof Error ? e.message : "could not toggle the feed");
    }
  }, [settings?.liveFeedIntervalMs]);

  const addManual = useCallback(async (value: number) => {
    await api.post("/rounds", { multiplier: value, source: "manual" });
  }, []);

  const importRounds = useCallback(async (values: number[], mode: "append" | "replace" = "append") => {
    await api.post("/rounds/bulk", { multipliers: values, mode });
    await refresh();
  }, [refresh]);

  const resetToSeed = useCallback(async () => {
    setLoading(true);
    await api.post("/rounds/reseed?count=900");
    await refresh();
  }, [refresh]);

  const clearAll = useCallback(async () => {
    await api.del("/rounds");
    setRounds([]);
    setTotal(0);
  }, []);

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    const res = await api.put<{ settings: Settings }>("/settings", patch);
    setSettings(res.settings);
    return res.settings;
  }, []);

  const multipliers = useMemo(() => rounds.map((r) => r.m), [rounds]);

  return {
    rounds,
    multipliers,
    total,
    loading,
    error,
    isLive,
    setIsLive,
    conn,
    lastAddedAt,
    addManual,
    importRounds,
    resetToSeed,
    clearAll,
    refresh,
    settings,
    saveSettings,
    context,
    openPrediction,
    alertFeed,
  };
});
