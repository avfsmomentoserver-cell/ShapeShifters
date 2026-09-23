/**
 * Backend transport.
 *
 * Everything durable lives in the FastAPI + SQLite service. Browser storage is
 * deliberately not used: the app runs inside a sandboxed frame where
 * localStorage/cookies throw, and a prediction ledger that can be edited by the
 * person being scored is not a ledger.
 */

const RAW_API = "__PORT_8000__";
export const API_BASE = RAW_API.startsWith("__") ? "http://localhost:8000" : RAW_API;

/** Shared workspace identity. The ~/Downloads watcher ingests as "local", so the
 * browser uses the same id to see the same tape and receive its WebSocket pushes. */
export const VISITOR_ID = "local";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Visitor-Id": VISITOR_ID,
    ...((init.headers ?? {}) as Record<string, string>),
  };
  // An empty Content-Type is the caller asking the browser to set it (multipart).
  if (headers["Content-Type"] === "") delete headers["Content-Type"];
  const res = await fetch(`${API_BASE}/api${path}`, { ...init, headers });
  if (!res.ok) {
    let body: unknown;
    let detail = res.statusText;
    try {
      body = await res.json();
      const d = (body as { detail?: unknown })?.detail;
      if (typeof d === "string") detail = d;
      else if (Array.isArray(d)) detail = d.map((x) => (x as { msg?: string })?.msg ?? "invalid").join("; ");
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail || `request failed (${res.status})`, res.status, body);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  /**
   * Multipart upload. Separate from post() because setting Content-Type by hand
   * strips the boundary the browser generates and the server rejects the body.
   */
  upload: <T>(path: string, file: File, field = "file") => {
    const form = new FormData();
    form.append(field, file);
    return request<T>(path, { method: "POST", body: form, headers: { "Content-Type": "" } });
  },
};

export function downloadUrl(path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${API_BASE}/api${path}${sep}visitor=${encodeURIComponent(VISITOR_ID)}`;
}

/** Live round push. Returns an unsubscribe function. */
export function openRoundSocket(
  onMessage: (msg: LiveMessage) => void,
  onStatus?: (s: "connecting" | "open" | "closed") => void,
): () => void {
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let attempts = 0;

  const connect = () => {
    if (closed) return;
    const url = `${API_BASE.replace(/^http/, "ws")}/ws/rounds?visitor=${encodeURIComponent(VISITOR_ID)}`;
    onStatus?.("connecting");
    try {
      socket = new WebSocket(url);
    } catch {
      onStatus?.("closed");
      return;
    }
    socket.onopen = () => {
      attempts = 0;
      onStatus?.("open");
    };
    socket.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(ev.data) as LiveMessage);
      } catch {
        /* ignore malformed frame */
      }
    };
    socket.onclose = () => {
      onStatus?.("closed");
      if (closed) return;
      attempts += 1;
      retry = setTimeout(connect, Math.min(10_000, 800 * 2 ** Math.min(attempts, 4)));
    };
    socket.onerror = () => socket?.close();
  };

  connect();
  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    socket?.close();
  };
}

// ---------------------------------------------------------------------------
// wire types
// ---------------------------------------------------------------------------

export interface ApiRound {
  id: number;
  ts: string;
  m: number;
  band: string | null;
  nonce: number | null;
  source: string;
}

export interface Settings {
  houseEdge: number;
  edgePreset: string;
  operator: string;
  currency: string;
  defaultTarget: number;
  bankroll: number;
  maxRiskPerRound: number;
  sessionLossLimit: number;
  liveFeedIntervalMs: number;
  simulatorEnabled: boolean;
  showResponsibleBanner: boolean;
  theme: string;
  confidenceFloor: number;
}

export interface LiveContext {
  rounds: number;
  last: number;
  dryStreak: number;
  dryStreak10x: number;
  recentHitRate2x: number;
  fairHitRate2x: number;
  pressure: number;
  meanLast50: number;
  medianLast50?: number;
  gamblersFallacyWarning?: string;
  [k: string]: unknown;
}

export interface PredictionEntry {
  id: number;
  targetRoundId: number | null;
  state: string;
  band: [number, number];
  probability: number;
  pAbove2: number;
  pAbove10: number;
  eta: number | null;
  actual: number | null;
  actualState: string | null;
  bandHit: boolean | null;
  hit2: boolean | null;
  hit10: boolean | null;
  brier: number | null;
  distribution: Record<string, number>;
  drivers: unknown;
  lockedAt: string;
  resolvedAt: string | null;
}

export interface AlertRow {
  id: number;
  name: string;
  kind: string;
  comparator: string;
  threshold: number;
  active: boolean;
  triggerCount: number;
  lastTriggeredAt: string | null;
  createdAt: string;
}

export interface AlertEventRow {
  id: number;
  alertId: number;
  name: string;
  value: number;
  roundId: number | null;
  firedAt: string;
}

export interface BetSessionRow {
  id: number;
  name: string;
  bankrollStart: number;
  bankrollCurrent: number;
  stake: number;
  target: number;
  lossLimit: number;
  status: string;
  startedAt: string;
  closedAt: string | null;
  bets: number;
  wins: number;
  pnl: number;
}

export interface BetRow {
  id: number;
  sessionId: number;
  stake: number;
  target: number;
  result: number;
  won: boolean;
  pnl: number;
  bankrollAfter: number;
  note: string | null;
  createdAt: string;
}

export type LiveMessage =
  | { type: "hello"; visitor: string; version: string; rounds: number }
  | {
      type: "round";
      round: ApiRound;
      resolved: number;
      locked: PredictionEntry | null;
      context: LiveContext;
      alerts: AlertEventRow[];
      state: string | null;
    }
  | { type: "bulk"; inserted: number; total: number };
