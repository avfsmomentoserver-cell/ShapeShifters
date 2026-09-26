---
name: ingest-tape
description: Load crash rounds into Momento from a file, a JSON/JSONL drop, the ~/Downloads watcher, or a SQLite database — with the column-recognition and preview guards that stop a stake or balance column from poisoning every downstream statistic.
allowed-tools:
  - read
  - grep
  - glob
  - exec
---

# Ingest a tape

Where the tape comes from matters more than any engine setting: every figure in
the app is computed from it. Reference: `docs/ai/backend.md` §ingest,
`backend/momento/ingest.py`, `backend/momento/watcher.py`.

## Four entry points

| Source | How |
| --- | --- |
| One round | `POST /api/rounds` `{"multiplier": 2.47}` |
| Many rounds | `POST /api/rounds/bulk` `{"multipliers": [...]}` |
| A dropped file | Put `.json`/`.jsonl` in `~/Downloads`. `watcher.py` polls every second and feeds the same pipeline as the API, so predictions resolve, alerts fire and the UI updates over the websocket. |
| A SQLite database | `POST /api/ingest/db/inspect` (preview, writes nothing) then `POST /api/ingest/db`. |

The watcher ships with dedupe that must be preserved: files are tracked by
`(path, size, mtime)` and a growing file is re-read from the last byte offset;
a file is marked seen only *after* ingest; every round keeps the timestamp it
claims so a re-read is skipped round-by-round on `(multiplier, timestamp)`.
`watcher_seen.json` persists that cache next to the DB — without it, a restart
re-ingests the whole directory and duplicates the tape.

## The SQLite import is the dangerous path

A file is opened **read-only and immutable**, and every numeric column is scored
on:

- the share of values that are valid multipliers,
- how close the median sits to the fair `2(1-h)`,
- tail heaviness,
- **whether the column is sorted** — a sorted column is a counter, not a tape.

The classic trap: an autoincrement `id / 100` looks exactly like plausible crash
points. So does a `stake`, a `balance`, or a `payout` column. Always run the
**inspect/preview** step first. It extracts without writing and compares the
observed exceedance rate at six thresholds against the fair curve for the
configured house edge, which catches a wrong column *before* it silently poisons
every rate, drought, interval and EV figure downstream.

Also handled for you — do not re-implement:

- integer storage is detected and converted (`234` → `2.34×`),
- timestamps are parsed from ISO strings and from unix seconds / ms / µs, and an
  all-digit string is read as an epoch, not a year,
- the original timestamps are kept, which is what makes cadence measurable and
  lets window odds convert rounds into minutes.

## Procedure

1. **Check the tape is what you think it is** before importing at volume:

   ```bash
   curl -s "localhost:8000/api/rounds?limit=5"
   curl -s "localhost:8000/api/stats/summary"
   ```

2. **Preview** a DB import with `POST /api/ingest/db/inspect`. Read the
   per-column verdicts. Pick the column whose share-of-valid-multipliers is
   high, whose median is near `2(1-h)`, and which is **not** sorted.

3. **Import** with `POST /api/ingest/db`, then re-read
   `/api/stats/summary` and `/api/randomness`. If the randomness battery turns
   red immediately after an import, suspect the column and the edge setting
   before suspecting the game.

4. **Confirm the edge.** `GET/PUT /api/settings` — a tape recorded at a 1% edge
   measured against a 4% setting will fail the chi-square and the KS test
   correctly but unhelpfully.

5. **Clean up** an upload with `DELETE /api/ingest/db/{upload_id}`, and remember
   `DELETE /api/rounds` and `POST /api/rounds/reseed` exist if you need a clean
   slate (`POST /api/sim/start` / `/api/sim/stop` control the simulator, and
   `POST /api/rounds/purge-simulator` removes its output).

## Never

- Commit a database or the `seed/` corpus — both are gitignored user data.
- Draw a shipped number from `seed/` without saying which file it came from.
- Import without previewing. Every downstream statistic inherits the mistake,
  and the app's whole purpose is that none of its numbers are sloppy.
