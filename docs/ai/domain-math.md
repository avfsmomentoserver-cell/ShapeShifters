# Domain maths — what the numbers mean and where they come from

Read this before changing anything in the analytics kernel or
`frontend/lib/*.ts` maths. Everything here is derived from the code; `path:line`
references name the source of truth. Where the repository's own user-facing
method page (`frontend/pages/Docs.tsx`) and this page disagree, the code wins,
then `Docs.tsx`, then this page.

## 1. The construction

`backend/momento/fairness.py:81` (`crash_point_stake`), house-documented form:

```
digest = HMAC_SHA256(key=server_seed, msg=f"{client_seed}:{nonce}")
i      = int(digest[:8], 16)                    # first 4 bytes, big-endian
raw    = (2**32 / (i + 1)) * (1 - house_edge)
crash  = floor(max(1.0, raw) * 100) / 100       # two decimals, never below 1.00
```

- `TWO_32 = 2 ** 32` (`fairness.py:32`). The tail is `i` ∈ [0, 2³²−1], so
  `raw` ∈ [1−h, 2³²(1−h)) and the distribution is a Pareto with index 1.
- `i + 1` in the denominator is what removes the divide-by-zero and makes the
  smallest observable crash `1 − h`.
- `_floor2` (`fairness.py:52`) is `math.floor(v * 100) / 100`. Rounding down, not
  to nearest, and applied *after* the floor of 1.0. Every published multiplier is
  a two-decimal floor of the raw value.
- Bustabit's variant is a separate function (`crash_point_bustabit`,
  `fairness.py:115`): a 52-bit derivation with a `1/divisor` instant bust
  (`divisor=101` by default). Do not conflate the two.

### Message conventions

Operators agree on HMAC-SHA256 over a seed pair but not on how the message is
assembled, so the templates are data, not code (`fairness.py:62`):

| Key | Template |
| --- | --- |
| `client:nonce` *(default)* | `{client}:{nonce}` |
| `client-nonce` | `{client}-{nonce}` |
| `nonce:client` | `{nonce}:{client}` |
| `clientnonce` | `{client}{nonce}` |
| `server:client:nonce` | `{server}:{client}:{nonce}` |
| `nonce-only` | `{nonce}` |
| `client-only` | `{client}` |

`DEFAULT_TEMPLATE = "client:nonce"` (`fairness.py:72`), and `build_message`
(`fairness.py:75`) accepts a raw format string as well as a key.

**A mismatch between the predicted and observed crash is much more often a wrong
convention than misconduct.** `solve_convention` (`fairness.py:258`) exists so
you do not have to guess; a round alone often cannot distinguish the templates
and the solver says so in its `note` (`fairness.py:298-304`). Only a revealed
seed that does not hash to its published commitment is unambiguous.

### Commit / reveal

`sha256_hex` (`fairness.py:40`, `hmac_sha256_hex` at `:44`) over the server seed
is published before play;
the crash point is deterministic only after revelation. Keep that split — the
whole fairness claim rests on it.

## 2. The identities

For house edge `h`:

```
P(reach m)   = (1 - h) / m        at m > 1
EV / unit    = -h                 at every cash-out target, by construction
median       = 2 * (1 - h)
Hill index   = 1.0                on a genuinely fair tape
E[wait to x] = x / (1 - h)        geometric, since p = (1-h)/x
P(gap >= g)  = (1 - p)^g
P(no hit in T) = (1 - p)^(T / c)  with c the measured cadence
Brier skill  = 1 - Brier_model / Brier_fair_price
```

Implemented at `ev.py:35` (`probability_above`), `ev.py:41`
(`median_crash`), `survival.py:29` / `windows.py:49` onwards. Asserted by
`backend/tests/test_reality_checks.py` (21 tests) and mirrored in
`frontend/test/hiteta.test.ts` (20 tests). **If a change breaks one of these,
either the change is wrong or you have found something real — in both cases stop
and say so, never edit the test to fit.**

The last line is the one people get wrong: on an independent tape the expected
skill is `≤ 0`, and it is *correct*. Do not tune until it looks good — that is
exactly the failure mode this product exists to expose.

## 3. Estimators, and the traps in them

### Survival — empirical below the tail, Hill in the tail

`survival.py:29` `empirical_survival` returns `None` when there are fewer than
`MIN_EXCEEDANCES = 8` (`:25`) observations at or above `x`; the count of
exceedances is noise below that. `hill_alpha` (`:39`) needs at least 40 usable
rounds (`:43`) and takes the top `TAIL_FRACTION = 0.15` (`:26`); `alpha` is
clamped to `[0.55, 2.5]` at `:53` with the comment that the fair index is exactly
1.0. `tail_survival` (`:57`) is `p_u * (u / x)^alpha` above the threshold, flat
`p_u` below it. `survival()` (`:66`) picks between them.

**The trap that created this design:** an exponential fit reported
`P(≥ 2×) ≈ 0.94` where the fair value is `0.485` — a factor-of-two error in `p`
that doubles every ETA downstream. Heavy-tailed data must be described
empirically below the cut and by Hill only in the tail, and only with enough
exceedances, with a blended fallback otherwise. `frontend/lib/stats.ts:362`
(`calibratedSurvival`) and `:344` (`hillAlpha`) mirror this on the client, with
the same `MIN_EXCEEDANCES` / `TAIL_FRACTION` constants at `stats.ts:331-332`.

### Randomness battery

`randomness.py` exports `chi_square_fit`, `ks_test`, `runs_test` (Wald-Wolfowitz
on above/below threshold coding), `autocorrelation`, `conditional_dependence`
(chi-square on previous band → `P(next ≥ threshold)`) and `digit_uniformity`,
wrapped by `full_battery` (`randomness.py:349`). `theoretical_survival`
(`:49`) is the fair-price baseline. `estimate_house_edge` (`:68`) recovers `h`
from the tape.

- A **passing** battery does not prove fairness and no finite test can. A
  **failing** one is more informative than six passes.
- The usual cause of a failure is a wrong edge setting or a small sample, not a
  rigged game. Check `/api/settings` first.
- Conditioning on a subset, a sliding window, or a digit test can fail on a fair
  tape for ordinary statistical reasons. One failing test on a large sample is
  weak evidence; a consistently failing one is a finding.

### Expected value, Kelly, ruin

`ev.py`: `probability_above` (`:35`), `median_crash` (`:41`), `ev_table`
(`:45`), `kelly` (`:82`), `expected_loss` (`:112`), `risk_of_ruin` (`:124`),
`martingale_analysis` (`:181`), `bankroll_plan` (`:220`).

`DEFAULT_EDGE = 0.03` (`:23`) and `HOUSE_EDGE_PRESETS` (`:25`) are the
standalone-call defaults — the *settings* value is authoritative in the app:

| Preset | Edge | RTP |
| --- | --- | --- |
| Aviator / Spribe | 0.03 | 0.97 |
| Stake Crash | 0.01 | 0.99 |
| Bustabit | 1/101 | 1 − 1/101 |
| JetX / SmartSoft | 0.03 | 0.97 |
| Spaceman / Pragmatic | 0.038 | 0.962 |
| Generic 95 % RTP | 0.05 | 0.95 |

Kelly on a negative edge must decline to bet (`test_kelly_declines_to_bet_a_negative_edge`);
ruin simulation must never report a negative bankroll and must reject nonsense
input (`test_risk_of_ruin_rejects_nonsense_input`). Because `EV/unit = -h` at
every target, the *only* quantity that changes your expected cost is turnover —
which is why a strategy comparison that omits turnover is broken, not lucky.

### Windows, droughts, phases, skill

`windows.py`: `wilson` (`:49`, z = 1.96), `median_wait` (`:59`),
`percentile_wait` (`:66`), `window_probability` (`:76`), `current_run` (`:82`),
`exceedance_grid` (`:96`), `droughts` (`:143`), `hour_phases` (`:190`),
`earned_skill` (`:344`), `per_round_probability` (`:381`),
`median_interval_ms` (`:463`), `window_odds` (`:499`), `leaderboard` (`:541`).

- Rates come with a Wilson interval, never as a bare point estimate.
- Waits come from the geometric distribution (`windows.py:59`: `median_wait` is
  `ceil(log(2) / -log(1 - p))`), and are `None` for impossible rates.
  `percentile_wait` (`:66`) carries a comment about a TypeScript original that
  returned 1 for every percentile — a fixed bug, covered by a test.
- `hour_phases` must find no time effect on a shuffled fair tape and must detect
  a planted one — both are asserted.
- `earned_skill` is walk-forward. Rebuilding a component from rounds `0…i-1` to
  predict round `i` is the only honest way to score it; anything else scores
  itself for free.

### Pattern engines and forecasting

- `pipeline.py`: `STATES = ["Collapse", "Shelf", "Normal", "Ignition",
  "Moonshot"]` (`:15`), `detect_ladders`, `detect_ceilings`, `classify_state`,
  `state_sequence`, `state_tail`, `transition_matrix`, `ladder_eta`, `dna_match`
  (z-normalised subsequence distance), `analyze`, `candidates`
  (band + ranked model candidates), `probability_above`, `survival_curve`.
- `math_models.py`: `pareto_fit` (alpha clamped `[0.2, 12.0]`, `:71`),
  `exponential_fit` (lambda clamped `[0.02, 8.0]`, `:91`), `markov_streaks`,
  `cluster_log`, `detect_regimes` (`low_vol`/`moderate`/`high_vol` with
  transitions), `fit_curve_shape`, `curve_shape_distribution`, `eta_estimate`
  (`:298`; blends the exponential bulk with the Pareto tail, weight
  `clamp((x - 2) / 4, 0, 1)`).
- `engines.py` hosts the radar / pressure / DNA / ladder engine layer;
  `strategies.py` the backtester and parameter grid.
- `windows.earned_skill` and the skill ledger decide how much weight a component
  actually earns. `test_no_component_earns_skill_on_a_fair_tape` is the guard.

`eta_estimate`'s blend is the legacy path the "ETA to big hits" figures moved
away from; `frontend/lib/stats.ts:401` (`hitEta`) over
`calibratedSurvival` is the calibrated replacement, and
`frontend/test/hiteta.test.ts` documents the ~94 %-vs-~48 % error it fixed.

### The forecast ledger

`pipeline.py` owns lock-then-resolve. Locking and resolution are **separate
writes** with separate timestamps (`locked_at`, `resolved_at`). Never mutate a
locked forecast's distribution, band or probability — a forecast that can be
edited after the fact is not a ledger, and the self-scoring claim collapses.
Scoring is Brier plus log loss against the fair price. Walk-forward is
mandatory; `frontend/lib/ledger.ts:127` (`walkForward`, warmup 150) mirrors it.

## 4. Documented numbers worth keeping straight

| Quantity | Value | Where |
| --- | --- | --- |
| Rounding | `floor(x * 100) / 100` | `fairness.py:52` |
| Minimum crash | 1.00 | `fairness.py`, `max(1.0, raw)` |
| Minimum exceedances for an empirical estimate | 8 | `survival.py:25` |
| Hill tail fraction | top 15 % | `survival.py:26` |
| Hill alpha clamp | `[0.55, 2.5]` | `survival.py:53` |
| Hill minimum sample | 40 rounds | `survival.py:43` |
| Pareto alpha clamp | `[0.2, 12.0]` | `math_models.py:71` |
| Exponential lambda clamp | `[0.02, 8.0]` | `math_models.py:91` |
| Wilson z | 1.96 | `windows.py:49` |
| Frontend `HOUSE_EDGE` default | 0.04 | `frontend/lib/stats.ts:15` |
| Backend `DEFAULT_EDGE` default | 0.03 | `ev.py:23` |

The last two rows disagree **on purpose**: the frontend constant is a display
fallback for standalone maths, and the app always reads the settings value from
the backend. Do not "harmonise" them without checking every call site.

## 5. Changing a formula

1. Run `/math-change-guard`.
2. Write down the identities the change touches (from §2).
3. Edit the Python **and** the mirrored TypeScript in the same change
   (`frontend/lib/{stats,pipeline,verifyForecast,backtest,ledger}.ts`), and
   update `frontend/test/hiteta.test.ts` if a pinned value moved.
4. Handle the degenerate inputs: empty tape, one round, no tail exceedances, all
   identical rounds, `h = 0`, a 1.00× floor, a round large enough to clamp the
   tail estimate.
5. Recompute the affected statistic on the live tape and quote **before/after**.
   "Tests pass" is not evidence the number is right; a measured delta is.
6. If the honest result is that the model has no skill, report that. It is the
   correct and expected finding.
