"""Rebuild the live tape from the ~/Downloads round archive — one-off repair.

Why this exists: the watcher failed to mark newly created archive files as
seen, so every file created after the watcher's first run was re-parsed and
re-ingested on each 1-second poll. The tape grew to ~4x the real round count,
stamped with ingest-clock timestamps instead of the rounds' own times, which
poisoned every statistic computed from it (cadence, dry streaks, hit rates,
ETAs) and every ledger resolution.

The archive is the source of truth: one file per round, each round carrying
its real timestamp, all 1,975 of them unique by timestamp (verified before
this script was written; re-verified on every run).

What it does, in order:
  1. Parse every archive file, normalise timestamps, drop sub-1.00x rounds.
  2. Verify uniqueness of (multiplier, timestamp) — refuse to run otherwise.
  3. Delete this workspace's rounds, prediction ledger and alert events.
     Alert *configurations* are kept.
  4. Re-insert the rounds sorted by their real timestamps, source "watcher".

After it runs, start/restart the API so the watcher re-arms a forecast on the
clean tape. Unseen archive files are re-scanned by the watcher once and
deduped round-by-round on (multiplier, timestamp), so the handover is safe.

Usage:  python3 scripts/rebuild_tape_from_archive.py [--dir ~/Downloads] [--yes]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from momento import db  # noqa: E402
from momento import watcher  # noqa: E402


def collect_archive_rounds(archive_dir: Path) -> list[tuple[str, float]]:
    pairs: dict[tuple[str, float], str] = {}
    files = sorted(archive_dir.glob("momento_rounds_aviator_*.json"))
    for path in files:
        for r in watcher._parse_file(path):
            m = round(float(r["multiplier"]), 2)
            if m < 1.0:
                continue
            ts = watcher._normalize_ts(r.get("timestamp"))
            if not ts:
                continue
            pairs.setdefault((m, ts), ts)
    rounds = sorted(pairs, key=lambda k: k[1])
    return [(m, ts) for (m, ts) in rounds]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(Path.home() / "Downloads"))
    ap.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    args = ap.parse_args()

    archive_dir = Path(args.dir).expanduser()
    rounds = collect_archive_rounds(archive_dir)
    if not rounds:
        print(f"no rounds found under {archive_dir}; nothing to do")
        return 1

    span = f"{rounds[0][1]} .. {rounds[-1][1]}"
    print(f"archive: {len(rounds)} unique rounds, {span}")
    before = db.count_rounds()
    print(f"tape now: {before} rounds (duplicates included)")
    if not args.yes:
        answer = input("delete the tape + ledger and rebuild from the archive? [y/N] ")
        if answer.strip().lower() != "y":
            print("aborted; nothing changed")
            return 1

    with db.SessionLocal() as s:
        n_rounds = s.query(db.Round).delete()
        n_preds = s.query(db.Prediction).delete()
        n_events = s.query(db.AlertEvent).delete()
        s.commit()
    print(f"cleared: {n_rounds} rounds, {n_preds} predictions, {n_events} alert events")

    inserted = db.insert_rounds_stamped(rounds, source="watcher")
    after = db.count_rounds()
    print(f"reinserted: {inserted} rounds with their real timestamps")
    print(f"tape now: {after} rounds ({before - after} duplicate rows removed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
