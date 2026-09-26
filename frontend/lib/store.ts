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
  type AiStatus,
  type AlertEventRow,
  type ApiRound,
  type LiveContext,
  type LiveMessage,
  type MultiTimeframeData,
  type PredictionEntry,
  type RealtimeBaseline,
  type RealtimeDelta,
  type RealtimeProjection,
  type RealtimeSummary,
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
  const [simulatorRunning, setSimulatorRunning] = useState(false);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [context, setContext] = useState<LiveContext | null>(null);
  const [openPrediction, setOpenPrediction] = useState<PredictionEntry | null>(null);
  const [alertFeed, setAlertFeed] = useState<AlertEventRow[]>([]);
  const [total, setTotal] = useState(0);
  // The realtime projection, the scheduled baseline it composes on, and the
  // revision they belong to. Held here rather than fetched by each panel so a
  // live frame and a poll can never disagree about which round the figures
  // describe.
  const [realtime, setRealtime] = useState<RealtimeProjection | null>(null);
  const [realtimeBaseline, setRealtimeBaseline] = useState<RealtimeBaseline | null>(null);
  const [realtimeDelta, setRealtimeDelta] = useState<RealtimeDelta | null>(null);
  const [realtimeAt, setRealtimeAt] = useState(0);
  const [multiTimeframe, setMultiTimeframe] = useState<MultiTimeframeData | null>(null);
  const revisionRef = useRef(0);
  const mounted = useRef(true);
  const newestRef = useRef(0);
  // Mirror of `total` for interval callbacks that must not re-arm on every
  // total change (re-arming would reset the probe cadence mid-stream).
  const totalRef = useRef(0);
  totalRef.current = total;

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

  /**
   * Pull the live projection. Separate from `refresh` and deliberately not
   * allowed to reject into the tape's error state: the projection is an
   * enhancement, and a panel that lost its headline must not blank the tape.
   *
   * This is also the dropped-frame recovery path — the hosted preview proxy can
   * drop websocket frames, and without this the realtime figures would freeze on
   * the last frame while the tape kept growing.
   */
  const refreshRealtime = useCallback(async () => {
    try {
      const body = await api.get<RealtimeSummary>("/stats/realtime");
      if (!mounted.current) return;
      // A poll can land after a newer live frame; the revision is monotonic, so
      // never let a slower read overwrite figures for a later round.
      if (body.revision < revisionRef.current) return;
      revisionRef.current = body.revision;
      setRealtime(body.realtime);
      setRealtimeBaseline(body.baseline);
      setRealtimeDelta(body.delta);
      setMultiTimeframe(body.multiTimeframe ?? null);
      setRealtimeAt(Date.now());
    } catch {
      /* the next tick retries; the tape continues regardless */
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    void refreshRealtime();
    api.get<LiveContext>("/context").then(setContext).catch(() => undefined);
    api.get<{ running: boolean }>("/sim/status").then((s) => setSimulatorRunning(s.running)).catch(() => undefined);
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
        // The realtime projection rides on the frame, so the headline numbers
        // update on the same tick as the round itself rather than one poll later.
        if (msg.realtime && (msg.revision ?? 0) >= revisionRef.current) {
          revisionRef.current = msg.revision ?? revisionRef.current;
          setRealtime(msg.realtime);
          // A live frame carries the baseline freshness and the drift too, so the
          // composition badge updates on the same tick as the round.
          if (msg.baseline) setRealtimeBaseline(msg.baseline);
          setRealtimeAt(Date.now());
        }
      } else if (msg.type === "bulk") {
        setTotal(msg.total);
        void refresh();
        void refreshRealtime();
      }
    }, setConn);
    return stop;
  }, [refresh, refreshRealtime]);

  // Catch-up after a socket outage. Frames lost while the proxy dropped the
  // connection never re-arrive — the server has already broadcast them — so on
  // reconnecting we must pull the tape once or the panels keep a hole (and a
  // stale open forecast) until the next poll tick. Only a closed→open
  // transition triggers this; the initial connecting→open would just duplicate
  // the mount refresh. A silently dead socket (no close event, conn still
  // "open") is covered by the /meta probe below instead.
  const prevConn = useRef<ConnState>("connecting");
  useEffect(() => {
    const prev = prevConn.current;
    prevConn.current = conn;
    if (conn === "open" && prev === "closed") void refresh();
  }, [conn, refresh]);

  // Activity-driven fallback. The hosted preview proxies plain HTTP reliably
  // but can drop websocket frames, which would leave the tape silently stale
  // while rounds keep arriving. The tape is fed by the watcher (external, on
  // its own cadence) even when the sim is OFF, so this cannot be gated on
  // isLive — that was exactly how the panels froze: sim off, WS frame dropped
  // by the proxy, and no poll left to recover.
  //
  // Two tiers, and the lower one never stops:
  //  - fast poll (liveFeedIntervalMs) while the socket is degraded or the tape
  //    is actively moving — this is the realtime path when frames are lost;
  //  - a permanent light /meta probe (one tiny request) that escalates to a
  //    full refresh the moment the server's round count differs from ours.
  // The probe is the fix for a deadlock the old stand-down timer had: once the
  // idle window expired, the poller stopped, and only a poll can notice a new
  // round — so a single quiet stretch froze tape, context AND the open forecast
  // until the next click. Worst-case staleness now is one probe interval.
  useEffect(() => {
    if (!lastAddedAt) return;
    const ms = Math.max(2000, settings?.liveFeedIntervalMs ?? 2500);

    const tick = () => {
      if (document.hidden) return; // nobody is watching; the probe still runs
      void refresh();
      void refreshRealtime();
      api.get<LiveContext>("/context").then(setContext).catch(() => undefined);
    };
    const probe = async () => {
      try {
        const meta = await api.get<{ rounds: number }>("/meta");
        if (meta.rounds !== totalRef.current) tick(); // tape moved — full refresh
      } catch {
        /* backend unreachable; the next probe retries */
      }
    };

    const fast = setInterval(tick, conn === "open" ? Math.max(ms, 30_000) : ms);
    const slow = setInterval(() => void probe(), 15_000);
    const wake = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearInterval(fast);
      clearInterval(slow);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [lastAddedAt, refresh, refreshRealtime, settings?.liveFeedIntervalMs, conn]);

  const setIsLive = useCallback(async (next: boolean) => {
    // Guard: the generator is opt-in. The tape is normally fed by the file
    // watcher alone, and a generator round mixed into it is exactly the
    // "random rounds" the feed is supposed to avoid. The backend enforces
    // simulatorEnabled too; this keeps the UI from even attempting a blocked
    // start.
    if (next && settings && !settings.simulatorEnabled) {
      setError("generator disabled — enable it in Settings to mix generated rounds into the file feed");
      return;
    }
    setSimulatorRunning(next);
    try {
      if (next) {
        const ms = settings?.liveFeedIntervalMs ?? 2500;
        await api.post(`/sim/start?intervalMs=${ms}`);
      } else {
        await api.post("/sim/stop");
      }
    } catch (e) {
      setSimulatorRunning(!next);
      setError(e instanceof Error ? e.message : "could not toggle the generator");
    }
  }, [settings?.liveFeedIntervalMs, settings?.simulatorEnabled, settings]);
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

  const purgeSimulator = useCallback(async () => {
    await api.post<{ removed: number; total: number }>("/rounds/purge-simulator");
    await refresh();
  }, [refresh]);

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    const res = await api.put<{ settings: Settings }>("/settings", patch);
    setSettings(res.settings);
    return res.settings;
  }, []);

  const multipliers = useMemo(() => rounds.map((r) => r.m), [rounds]);

  // The tape is live while it has moved recently — that is the honest "live feed"
  // signal: the ~/Downloads watcher feeds it on its own cadence, independently of
  // the generator. The tick re-evaluates the freshness window on a schedule that
  // stops once the tape has been silent past it, so the status flips to paused
  // without a permanent re-render timer.
  const [feedTick, setFeedTick] = useState(0);
  useEffect(() => {
    if (!lastAddedAt) return;
    const id = setInterval(() => {
      if (Date.now() - lastAddedAt > 90_000) {
        clearInterval(id);
        return;
      }
      setFeedTick((t) => t + 1);
    }, 15_000);
    return () => clearInterval(id);
  }, [lastAddedAt]);
  const liveFeedActive = useMemo(
    () => lastAddedAt > 0 && Date.now() - lastAddedAt < 60_000,
    [lastAddedAt, feedTick],
  );

  return {
    rounds,
    multipliers,
    total,
    loading,
    error,
    isLive: simulatorRunning,
    simulatorRunning,
    liveFeedActive,
    setIsLive,
    conn,
    lastAddedAt,
    addManual,
    importRounds,
    resetToSeed,
    clearAll,
    purgeSimulator,
    refresh,
    settings,
    saveSettings,
    context,
    openPrediction,
    alertFeed,
    realtime,
    realtimeBaseline,
    realtimeDelta,
    realtimeAt,
    multiTimeframe,
    refreshRealtime,
  };
});
