# Momento — crash-curve analytics terminal

A full-stack analytics terminal for crash-curve games (Aviator, Stake Crash, Bustabit,
JetX, Spaceman). FastAPI + SQLite backend, React + Vite + Tailwind frontend.

**What this is:** measurement. It verifies provably-fair rounds, tests a tape for
independence, calibrates survival probabilities, scores its own forecasts honestly, and
computes the real expected value of every bet. **What it is not:** a betting signal. A
correctly implemented crash game is unpredictable and every stake carries negative
expected value.

---

## Run it

Two processes. Backend first.

### Backend (Python 3.11+)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate    # optional
pip install -r requirements.txt
python -m uvicorn momento.api:app --host 0.0.0.0 --port 8000
```

API docs at `http://localhost:8000/docs`. State lives in `backend/momento.db`
(SQLite, WAL mode). Delete `momento.db*` to wipe everything and reseed the demo tape.

### Frontend (Node 20+)

```bash
npm install
npm run dev        # http://localhost:5173
```

`frontend/lib/api.ts` resolves the API base from the `__PORT_8000__` build placeholder
and falls back to `http://localhost:8000` during local development, so `npm run dev`
works with no configuration.

Production build:

```bash
npm run build      # -> dist/
```

`dist/` is a static bundle. Serve it from anything; it talks to the backend over HTTP
and (when available) a websocket. `base` is `"./"` so the bundle works from a subpath.

### Tests

```bash
cd backend && python -m pytest tests -q     # 34 tests
```

`tests/test_reality_checks.py` checks the crash identities in closed form — the
HMAC construction, `P(reach m) = (1-h)/m`, `median = 2(1-h)`, `EV = -h`, a Hill tail
index near 1.0, and that the randomness battery passes a genuinely fair tape while
rejecting a rigged one.

---

## Layout

```
backend/momento/
  api.py          REST surface + /ws/rounds websocket, visitor-scoped
  db.py           SQLAlchemy models, serializers, session/bet ledger
  fairness.py     HMAC-SHA256 crash-point reproduction + convention solver
  randomness.py   chi-square, KS, runs, autocorrelation, conditional
                  dependence, digit uniformity
  survival.py     empirical survival curve + Hill tail index
  ev.py           expected value, Kelly, ruin simulation
  strategies.py   strategy backtester + parameter grid
  engines.py      pattern engines (radar, pressure, DNA, ladders)
  pipeline.py     forecast lock/resolve + Brier scoring
  math_models.py  shared distribution helpers

frontend/
  pages/          21 routes
  components/     AppShell (sidebar menu), kit.tsx (design primitives)
  lib/api.ts      typed fetch client, visitor header, websocket
  lib/store.ts    backend-backed app state (no localStorage — blocked in
                  sandboxed iframes)
  index.css       phosphor-green terminal design system
```

## The math, and where it comes from

Crash point for a provably-fair round:

```
digest = HMAC_SHA256(server_seed, f"{client_seed}:{nonce}")
i      = int(digest[:8], 16)
raw    = (2**32 / (i + 1)) * (1 - house_edge)
crash  = floor(max(1, raw) * 100) / 100
```

Consequences, all of which the app measures against the live tape:

- `P(reach m) = (1 - h) / m`
- `EV per unit staked = -h`, at every cash-out target
- `median crash = 2(1 - h)`

Sources:

- Provably-fair crash verification — https://provenlyfair.com/blog/verify-provably-fair-crash/
- Crash game mathematics — https://crashedge.com/guides/crash-gambling-maths/
- Optimal bet sizing / Kelly with a house edge — https://crashedge.com/strategy/optimal-bet-sizing-crash-games/
- Bankroll management — https://crashedge.com/strategy/bankroll-management-crash-games/
- Kelly criterion — https://en.wikipedia.org/wiki/Kelly_criterion

## Responsible use

Gambling causes real harm. Help is available at
[BeGambleAware](https://www.begambleaware.org/),
[Gambling Therapy](https://www.gamblingtherapy.org/) and
[Gamblers Anonymous](https://www.gamblersanonymous.org/ga/locations).
