---
name: verify-provably-fair
description: Verify that a crash round was dealt as committed — reproduce the HMAC-SHA256 crash point, check the seed commitment, and brute-force the operator's message convention when the template is unknown. Use when auditing a round, a seed pair, or a tape of revealed seeds.
allowed-tools:
  - read
  - grep
  - glob
  - exec
---

# Verify a round is provably fair

The user-facing version of this is the `/fairness` page; the maths page is
`frontend/pages/Docs.tsx` §"provably fair verification"; the code is
`backend/momento/fairness.py` and the routes are `/api/fair/*`.

## The construction

```
digest = HMAC_SHA256(server_seed, "<message>")
i      = int(digest[:8], 16)
raw    = (2**32 / (i + 1)) * (1 - house_edge)
crash  = floor(max(1, raw) * 100) / 100
```

Operators agree on the primitive but **not** on how the message is assembled.
`fairness.py` ships seven message templates and a solver, and the API exposes
all of them:

| Route | Use |
| --- | --- |
| `POST /api/fair/verify` | One round: server seed, client seed, nonce, expected crash. |
| `POST /api/fair/verify-batch` | A tape of rounds. |
| `POST /api/fair/solve` | Brute-force the convention from a single known round. |
| `GET /api/fair/conventions` | The list the solver searches. |
| `POST /api/fair/chain` | Seed chain / commitment chain. |
| `GET /api/fair/hash` | `sha256(server_seed)` for a commitment check. |
| `GET /api/fair/audits` | Stored audits (`seed_audits` table). |
| `GET /api/fair/tape` | Generate a known-good provably-fair tape. |

## Procedure

1. **Get the three inputs plus the published commitment.** You need the
   revealed `server_seed`, the `client_seed`, the `nonce`, and — separately —
   the operator's published `sha256(server_seed)` from before play. Without the
   revealed seed, "provably fair" is a marketing phrase and there is nothing to
   verify.

2. **Check the commitment first.**
   `curl "localhost:8000/api/fair/hash?server_seed=..."` and compare to what the
   operator published. **This is the only unambiguous failure mode.** A revealed
   seed that does not hash to its published commitment is a proven breach.

3. **Solve the convention before judging the crash point.** A mismatch between
   the expected and reproduced multiplier usually means the operator assembles
   the message differently, not that the game is rigged. Use
   `POST /api/fair/solve` with one round you know the outcome of. Only after the
   convention is pinned does a later mismatch mean anything.

4. **Then verify the round(s).** `POST /api/fair/verify` for one,
   `/verify-batch` for a tape. Confirm the house edge you pass matches the
   operator's published edge — a wrong edge produces a wrong `raw` and a false
   mismatch.

5. **Record it.** `seed_audits` stores label, algorithm, seeds, nonce, expected,
   observed, `matched`, `commitment_valid`. Persist findings so they are
   reviewable later.

## What you may and may not claim

- **May:** "round *n* was dealt as committed", "seed revealed at time *t* hashes
  to the commitment published at *t-1*", "this sample is *consistent with*
  independent fair draws", "this sample is not".
- **May not:** "the operator is honest", "the game is fair", "this is a good
  place to play". A verification covers one revealed round; a battery covers a
  sample; neither establishes an operator's character, and neither changes the
  expected value of the next bet, which remains `-h × stake`.

## Environment

`curl -s localhost:8000/api/health` first — the backend must be running.
`hashlib`/`hmac` are stdlib, so the CLI route is
`cd backend && python3 -m pytest tests/test_reality_checks.py -q` to confirm the
construction itself is intact before you debug an operator's round.
