import { createServer } from "node:http";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import path from "node:path";
import process from "node:process";

const PORT = Number(process.env.PORT ?? 8787);
const WATCH_DIR = process.env.MOMENTO_WATCH_DIR ?? "/home/pirate/Downloads";
const DATA_DIR = process.env.MOMENTO_DATA_DIR ?? path.resolve("data");
const DB_FILE = path.join(DATA_DIR, "rounds.json");
const MAX_ROUNDS = 5000;
let writeQueue = Promise.resolve();

async function readDb() {
  try {
    const content = await readFile(DB_FILE, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.rounds) ? parsed : { rounds: [] };
  } catch (error) {
    if (error.code === "ENOENT") return { rounds: [] };
    throw error;
  }
}

function persistDb(db) {
  writeQueue = writeQueue.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const tempFile = `${DB_FILE}.tmp`;
    await writeFile(tempFile, JSON.stringify({ ...db, updatedAt: new Date().toISOString() }, null, 2));
    await rename(tempFile, DB_FILE);
  });
  return writeQueue;
}

function parsePayload(text) {
  const payload = JSON.parse(text);
  return [...(payload.rounds ?? []), ...(payload.top_rounds ?? [])]
    .map((round) => ({
      timestamp: new Date(round.timestamp).toISOString(),
      multiplier: Number(round.multiplier),
      color: round.color ?? "",
      source: round.source ?? payload.source ?? "aviator",
    }))
    .filter((round) => Number.isFinite(round.multiplier) && round.multiplier > 0 && !Number.isNaN(Date.parse(round.timestamp)));
}

async function ingestFile(filePath) {
  if (!filePath.endsWith(".json")) return 0;
  try {
    const db = await readDb();
    const incoming = parsePayload(await readFile(filePath, "utf8"));
    const known = new Set(db.rounds.map((round) => `${round.timestamp}|${round.multiplier}`));
    const added = incoming.filter((round) => {
      const signature = `${round.timestamp}|${round.multiplier}`;
      if (known.has(signature)) return false;
      known.add(signature);
      return true;
    });
    if (added.length > 0) {
      db.rounds = [...db.rounds, ...added].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-MAX_ROUNDS);
      await persistDb(db);
    }
    await unlink(filePath);
    console.log(`[live-db] ingested ${path.basename(filePath)}: ${added.length} new rounds`);
    return added.length;
  } catch (error) {
    console.error(`[live-db] failed ${path.basename(filePath)}: ${error.message}`);
    return 0;
  }
}

async function scanWatchDir() {
  if (!existsSync(WATCH_DIR)) return;
  for (const name of await readdir(WATCH_DIR)) await ingestFile(path.join(WATCH_DIR, name));
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" });
    return response.end();
  }
  if (request.url === "/api/health" && request.method === "GET") {
    return sendJson(response, 200, { ok: true, database: DB_FILE, watchDir: WATCH_DIR });
  }
  if (request.url === "/api/rounds" && request.method === "GET") {
    const db = await readDb();
    return sendJson(response, 200, { rounds: db.rounds });
  }
  if (request.url === "/api/rounds" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", async () => {
      try {
        const incoming = JSON.parse(body).rounds ?? [];
        const db = await readDb();
        const known = new Set(db.rounds.map((round) => `${round.timestamp}|${round.multiplier}`));
        const added = incoming.filter((round) => {
          const signature = `${round.timestamp}|${round.multiplier}`;
          if (known.has(signature)) return false;
          known.add(signature);
          return true;
        });
        db.rounds = [...db.rounds, ...added].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-MAX_ROUNDS);
        await persistDb(db);
        sendJson(response, 200, { added: added.length, rounds: db.rounds });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }
    });
    return;
  }
  sendJson(response, 404, { error: "Not found" });
});

await mkdir(DATA_DIR, { recursive: true });
if (existsSync(WATCH_DIR)) {
  watch(WATCH_DIR, (_, filename) => {
    if (filename) void ingestFile(path.join(WATCH_DIR, filename));
  });
  void scanWatchDir();
  console.log(`[live-db] watching ${WATCH_DIR}`);
} else {
  console.log(`[live-db] watch directory missing: ${WATCH_DIR}`);
}
server.listen(PORT, "0.0.0.0", () => console.log(`[live-db] http://localhost:${PORT}`));
