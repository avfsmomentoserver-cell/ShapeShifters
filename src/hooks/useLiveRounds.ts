import { useCallback, useEffect, useRef, useState } from "react";
import { classifyShapeAdvanced } from "@/lib/analysis";
import type { Round } from "@/lib/types";

type RawRound = {
  timestamp?: string;
  multiplier?: number;
  color?: string;
};

type CollectorPayload = {
  rounds?: RawRound[];
  top_rounds?: RawRound[];
};

type FeedStatus = "waiting" | "watching" | "imported" | "error";

type DirectoryHandle = {
  values: () => AsyncIterableIterator<{
    kind: string;
    name: string;
    getFile: () => Promise<File>;
  }>;
  removeEntry?: (name: string) => Promise<void>;
};

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandle>;
};

const MAX_ROUNDS = 500;
const POLL_INTERVAL_MS = 1000;
const DB_NAME = "shapeshifters-live-feed";
const STORE_NAME = "rounds";

function openRoundDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "signature" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open live feed database."));
  });
}

async function loadStoredRounds(): Promise<Round[]> {
  const db = await openRoundDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as Array<{ round: Round }>).map((item) => item.round));
    request.onerror = () => reject(request.error ?? new Error("Could not read live feed database."));
  });
}

async function storeRounds(rounds: Round[]): Promise<void> {
  if (rounds.length === 0) return;
  const db = await openRoundDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    for (const round of rounds) {
      store.put({ signature: `${round.timestamp}|${round.multiplier}`, round });
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save live rounds."));
  });
}

async function fetchBackendRounds(): Promise<RawRound[]> {
  const response = await fetch("/api/rounds");
  if (!response.ok) throw new Error("Live database is unavailable.");
  const payload = (await response.json()) as { rounds?: RawRound[] };
  return payload.rounds ?? [];
}

async function postBackendRounds(rounds: Round[]): Promise<void> {
  if (rounds.length === 0) return;
  await fetch("/api/rounds", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rounds }),
  });
}

function toRound(raw: RawRound, id: number, history: Round[]): Round | null {
  const multiplier = Number(raw.multiplier);
  const timestamp = raw.timestamp ? new Date(raw.timestamp) : null;
  if (!Number.isFinite(multiplier) || multiplier <= 0 || !timestamp || Number.isNaN(timestamp.getTime())) {
    return null;
  }

  const { shape, confidence, features } = classifyShapeAdvanced(multiplier, history);
  return {
    id,
    timestamp: timestamp.toISOString(),
    time: timestamp.toLocaleTimeString(),
    multiplier: Number(multiplier.toFixed(2)),
    shape,
    confidence,
    features,
  };
}

function parsePayload(text: string): RawRound[] {
  const payload = JSON.parse(text) as CollectorPayload;
  return [...(payload.rounds ?? []), ...(payload.top_rounds ?? [])];
}

export function useLiveRounds() {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [status, setStatus] = useState<FeedStatus>("waiting");
  const [lastFile, setLastFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const directoryRef = useRef<DirectoryHandle | null>(null);
  const seenFilesRef = useRef(new Set<string>());
  const roundsRef = useRef<Round[]>([]);

  useEffect(() => {
    void Promise.all([loadStoredRounds(), fetchBackendRounds().catch(() => [])])
      .then(([stored, backendRaw]) => {
        const restored = [...stored];
        const known = new Set(restored.map((round) => `${round.timestamp}|${round.multiplier}`));
        for (const raw of backendRaw) {
          const candidate = toRound(raw, restored.length + 1, restored);
          if (!candidate) continue;
          const signature = `${candidate.timestamp}|${candidate.multiplier}`;
          if (!known.has(signature)) {
            known.add(signature);
            restored.push(candidate);
          }
        }
        const trimmed = restored.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-MAX_ROUNDS);
        roundsRef.current = trimmed;
        setRounds(trimmed);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not restore saved rounds."));
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchBackendRounds()
        .then(async (backendRaw) => {
          const next = [...roundsRef.current];
          const known = new Set(next.map((round) => `${round.timestamp}|${round.multiplier}`));
          const added: Round[] = [];
          for (const raw of backendRaw) {
            const candidate = toRound(raw, next.length + 1, next);
            if (!candidate) continue;
            const signature = `${candidate.timestamp}|${candidate.multiplier}`;
            if (known.has(signature)) continue;
            known.add(signature);
            next.push(candidate);
            added.push(candidate);
          }
          if (added.length === 0) return;
          await storeRounds(added);
          roundsRef.current = next.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-MAX_ROUNDS);
          setRounds(roundsRef.current);
          setStatus("imported");
        })
        .catch(() => undefined);
    }, POLL_INTERVAL_MS * 2);
    return () => window.clearInterval(interval);
  }, []);

  const addPayload = useCallback(async (text: string, fileName: string) => {
    const rawRounds = parsePayload(text);
    const known = new Set(roundsRef.current.map((round) => `${round.timestamp}|${round.multiplier}`));
    const next = [...roundsRef.current];
    const added: Round[] = [];
    for (const raw of rawRounds) {
      const candidate = toRound(raw, next.length + 1, next);
      if (!candidate) continue;
      const signature = `${candidate.timestamp}|${candidate.multiplier}`;
      if (known.has(signature)) continue;
      known.add(signature);
      next.push(candidate);
      added.push(candidate);
    }
    await storeRounds(added);
    await postBackendRounds(added).catch(() => undefined);
    roundsRef.current = next.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-MAX_ROUNDS);
    setRounds(roundsRef.current);
    setLastFile(fileName);
    setStatus("imported");
    setError(null);
    return added.length > 0;
  }, []);

  const importFiles = useCallback(async (files: FileList | File[]) => {
    const candidates = Array.from(files).filter((file) => file.name.endsWith(".json"));
    try {
      for (const file of candidates) {
        const key = `${file.name}|${file.lastModified}|${file.size}`;
        if (seenFilesRef.current.has(key)) continue;
        seenFilesRef.current.add(key);
        await addPayload(await file.text(), file.name);
      }
      if (candidates.length === 0) {
        setError("No JSON collector files found.");
        setStatus("error");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read collector files.");
      setStatus("error");
    }
  }, [addPayload]);

  const scanDirectory = useCallback(async () => {
    const directory = directoryRef.current;
    if (!directory) return;
    const files: Array<{ file: File; name: string }> = [];
    for await (const entry of directory.values()) {
      if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
      files.push({ file: await entry.getFile(), name: entry.name });
    }
    for (const candidate of files) {
      const added = await addPayload(await candidate.file.text(), candidate.file.name);
      if (added && directory.removeEntry) await directory.removeEntry(candidate.name);
    }
  }, [addPayload]);

  const chooseFolder = useCallback(async () => {
    const picker = window as PickerWindow;
    if (!picker.showDirectoryPicker) {
      setError("This browser cannot watch a folder. Choose the JSON files below instead.");
      setStatus("error");
      return false;
    }
    try {
      directoryRef.current = await picker.showDirectoryPicker({ mode: "readwrite" });
      await scanDirectory();
      setStatus("watching");
      setError(null);
      return true;
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return false;
      setError(caught instanceof Error ? caught.message : "Could not open that folder.");
      setStatus("error");
      return false;
    }
  }, [scanDirectory]);

  useEffect(() => {
    if (!directoryRef.current) return;
    const interval = window.setInterval(() => void scanDirectory(), POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [scanDirectory, status]);

  const clearRounds = useCallback(() => {
    setRounds([]);
    roundsRef.current = [];
    seenFilesRef.current.clear();
    setLastFile(null);
    setStatus("waiting");
    setError(null);
  }, []);

  return {
    rounds,
    currentMultiplier: rounds.at(-1)?.multiplier ?? null,
    status,
    lastFile,
    error,
    chooseFolder,
    importFiles,
    clearRounds,
  };
}