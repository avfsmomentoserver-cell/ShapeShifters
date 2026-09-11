/**
 * The full research treatise, bundled into the app and included verbatim in
 * every source download. Written as long-form derivations per the source
 * README's non-negotiable: "full comprehensive researched documented
 * solutions only".
 */
export const RESEARCH_DOC = `# Shapeshifters — Crash-Curve Research Compendium
### Mathematical foundations for shape-based forecasting of crash rounds

Version 1.0.0 · Generated with the app · Includes validation methodology

---

## 0. Problem statement

We observe an ordered series of crash rounds \`R_1, R_2, ... R_n\` where each
round ends at a crash multiplier \`M_i >= 1\`. Round recording is sometimes cut
short, so the database contains **multiple interleaved series**; every
estimator below therefore only consumes contiguous windows (\`slice(-k)\`) and
never assumes cross-series continuity. The goal: from the **shape** of the
curve — how multipliers move through round data — derive (a) the most
reliable timeframe at which to expect a target multiplier, (b) streak
persistence, (c) dry-zone timing, and (d) high-volatility moonshot clusters,
each with an explicit confidence.

> **Honesty axiom.** Crash games are engineered so that
> \`E[M] = 1/(1 - h)\` with house edge \`h\` (e.g. \`h = 0.03 → E[M] ≈ 1.03\`
> under a Pareto-tail design). No estimator beats the edge in expectation;
> what this library delivers is *temporal structure statistics* — when risk
> concentrates — never a positive-expectation signal. Every forecast below is
> a conditional-probability statement, not a guarantee.

---

## 1. Curve anatomy and the shape taxonomy

### 1.1 The canonical growth law

Between launch and crash the on-screen multiplier grows approximately
exponentially:

    M(t) = e^(g·t),   g ≈ 0.06 s⁻¹  (typical crash-game growth rate)

Inverting, the *time-to-reach* a multiplier \`x\` is

    t(x) = ln(x) / g = (1/0.06)·ln(x) ≈ 16.67·ln(x) seconds

This single identity converts **multiplier space ↔ time space** and is why
"shape through round data" and "timeframe to expect a multiplier" are the
same problem viewed twice.

### 1.2 Crash-point distribution

With a 1% instant-crash rate and a Pareto-shaped tail with edge \`h\`:

    P(M > x) ≈ (1-h) / x        for x >= 1 (heavy tail, index α → 1)

Consequences used throughout the app:

| Shape       | Range        | Tail statement                |
|-------------|--------------|-------------------------------|
| early-crash | M < 1.5x     | P(M < 1.5) ≈ 1 - (1-h)/1.5 ≈ 35% |
| standard    | 1.5–2.5x     | density ∝ 1/x², mode near 1.5 |
| extended    | 2.5–5x       | P(M > 2.5) ≈ (1-h)/2.5 ≈ 39%  |
| moonshot    | 5–10x        | P(M > 5) ≈ (1-h)/5 ≈ 19%      |
| extreme     | > 10x        | P(M > 10) ≈ (1-h)/10 ≈ 9.7%   |

The app's shape classifier is exactly these indicator functions evaluated on
each observed round; the "Curve Shapes" tab reports empirical frequencies so
they can be compared against the theoretical column (see §7 validation).

### 1.3 Windowed sample statistics

For a window \`W = {M_{n-k+1}, ..., M_n}\` of the last \`k\` rounds:

    μ_W = (1/k) Σ M_i                     (empirical mean crash point)
    σ_W = sqrt( (1/k) Σ (M_i - μ_W)² )    (empirical volatility)

These feed the ETA estimator (§6) and the quick-stat header. Because the
distribution is heavy-tailed, μ_W is upward-biased by extremes; a
median-based variant is provided in \`analysis.ts\` for robustness checks.

---

## 2. Streak theory — runs above/below threshold

**Definition.** A *win run* is a maximal consecutive sequence with
\`M_i >= 2\`; a *loss run* is the complement. (Threshold \`t = 2\` is the
classic cash-out point.)

### 2.1 Expected run lengths

If \`p = P(M >= t)\`, the run-length distribution is geometric:

    P(run = k) = p^(k-1)(1-p),  E[run | win] = 1/(1-p),  E[run | loss] = 1/p

With \`p ≈ P(M >= 2) = (1-h)/2 ≈ 0.485\`: win runs average ≈ 1.94 rounds, loss
runs ≈ 2.06. Runs of length ≥ 3 occur with probability \`p³\` per position —
the "Hot Streaks (3+)" counter estimates this empirical rate.

### 2.2 Wald–Wolfowitz runs test (persistence check)

Let \`n_w\`, \`n_l\` be the counts of wins/losses and \`r\` the observed number of
runs. Under independence:

    E[r] = 1 + 2·n_w·n_l / (n_w + n_l)
    Var[r] = 2n_wn_l(2n_wn_l - n) / (n²(n-1)),  n = n_w + n_l

A standardized statistic \`z = (r - E[r]) / sqrt(Var[r])\` with \`|z| > 2\`
indicates the window carries genuine streak structure (clustering) beyond
chance. The Streak tab exposes \`z\` live; |z| < 2 means current streaks are
indistinguishable from i.i.d. noise — *treat every "streak signal" as
descriptive*.

---

## 3. Dry zones — runs of sub-1.5x rounds

**Definition.** A *dry zone* is ≥ 2 consecutive rounds with \`M < 1.5\`.
With \`q = P(M < 1.5) ≈ 0.35\`, zone *starts* form a Bernoulli(\`q²\`) renewal
process at first approximation, hence inter-arrival gaps are geometric:

    E[gap] ≈ 1/q² ≈ 8.2 rounds,  P(gap ≤ g) = 1 - (1-q²)^g

### 3.1 Conditional (hazard) view — the "reliable timeframe"

Memorylessness of the geometric law means *the fact that you are 20 rounds
past the last dry zone does not raise the hazard*. What **does** concentrate
risk is the current window state:

    P(dry zone starts within next 3 rounds | recent low-density d)
        ≈ 1 - (1 - q_eff)³ ,   q_eff = clamp(d + (q - d)/2, 0.15, 0.6)

where \`d\` = fraction of the last 20 rounds under 2x. The Dry-Zone tab's
probability ring is exactly this clamp rule (the source's
\`min(lowMultipliers/20 · 100, 95)\` is the special case without smoothing).
Estimated-in-rounds uses the empirical mean gap between observed zone
starts; confidence is "high" once \`n > 30\` rounds are in the window.

### 3.2 Zone length

Conditional on being in a dry round, the chance the zone continues is
\`q\`, so zone length ~ Geometric(q): E[length] = 1/q ≈ 2.9, matching the
histogram of observed \`count\`s. Zones of length ≥ 6 (p ≈ 0.35⁵ ≈ 0.5%)
are legitimate tail events, not "due for reversal" evidence.

---

## 4. Moonshot clusters — Poisson clumping / scan statistics

**Definition.** A moonshot is \`M >= 5\`; two moonshots with index gap ≤ 10
rounds join the same *cluster*.

### 4.1 Cluster formation

With rate \`λ = P(M >= 5) ≈ 0.19\` per round, moonshot arrivals are
approximately Poisson(\`λn\`) in a window of \`n\` rounds. The probability that
a moonshot is followed by another within 10 rounds is

    P(join) = 1 - e^(-λ·10) ≈ 0.85

so clustering is the *norm*, not the anomaly — the app's cluster counter
measures how strongly arrivals bunch beyond this baseline.

### 4.2 Momentum score

Define recent high-density

    d_hi = #{i in last 30: M_i >= 3} / 30

and recency factor \`ρ = min(rounds_since_last / avg_gap, 1)\`. The composite

    P̂ = 30 + 40·d_hi + 30·ρ        (capped at 95)

is the prediction ring shown live. Momentum is labelled strong / moderate /
weak at \`d_hi > 0.3 / 0.15\`. Mathematically this is a weighted evidence mix,
not a calibrated posterior; §7's calibration plot is the tool that says how
honest the number is.

---

## 5. Shape-through-time: reading the curve itself

Beyond round outcomes, the trajectory \`M(t)\` inside a round carries shape
information. Three invariants the feed tracks:

1. **Concavity regime.** Under \`M = e^{gt}\` the curve is convex; any
   detected plateau (first difference \`ΔM < ε\` for > 2 s) marks a
   provider-side tick-rate change — a regime flag, not a forecast.
2. **Slope percentile.** The current slope \`ĝ = Δln(M)/Δt\` ranked against
   the trailing 200 segments; \`ĝ\` above the 90th percentile historically
   co-occurs with extended/moonshot rounds.
3. **Survival hazard.** The empirical hazard \`h(t) = P(crash in [t, t+dt] |
   alive at t)\` estimated by Nelson–Aalen over truncated rounds (rounds cut
   short contribute exposure time but no event — the correct treatment of
   the truncated DB series).

Nelson–Aalen cumulative hazard:

    Ĥ(t) = Σ_{t_i ≤ t} d_i / n_i

where \`d_i\` = crashes at tick \`i\`, \`n_i\` = rounds still alive. This is the
statistically sound way the "multiple truncated rounds" caveat is handled.

---

## 6. ETA estimator — stochastic crash-point model

Given current multiplier \`m₀\` and window stats \`μ_W, σ_W\`:

1. **Estimated crash point** \`x̂ = μ_W\` (20-round window).
2. **Time remaining** via the growth law:
   \`T = ln(x̂ / m₀) / g\`, floored at 0.
3. **Crash-probability ladder** — Gaussian kernel over candidate exits
   \`x_j = m₀ + 0.5j, j = 1..10\`:
   \`P(x_j) = min(100·exp(-(x_j - x̂)² / (2σ_W²)), 99)\`
4. **Confidence** tiers purely by sample size: > 30 high, > 15 medium, ≥ 5
   low; below 5 the estimator refuses to answer.

The Gaussian kernel is a *local* approximation to the posterior crash
density around the current level; it degrades gracefully — as \`σ_W → 0\` the
ladder collapses to a spike at \`x̂\` (the deterministic answer), and as
\`σ_W\` grows it flattens toward the heavy tail prior.

---

## 7. Validation methodology (non-negotiable per README)

Every shipped estimator must pass, on held-out windows:

1. **Backtesting protocol.** Rolling-origin evaluation: fit on \`W_{t-k}\`,
   predict \`t+1..t+h\`, advance by 1. Metrics: Brier score for the
   probability rings, mean absolute error (MAE) for estimated-in-rounds.
2. **Calibration.** Group predictions into deciles; reliability curve slope
   should be ≈ 1. The app prints sample size + confidence tier beside every
   ring so under-calibrated states are visible.
3. **Distributional tests.** One-sample Kolmogorov–Smirnov of window
   multipliers against the fitted Pareto tail \`F(x) = 1 - (1-h)/x\`;
   Ljung–Box on the win/loss indicator sequence for autocorrelation.
4. **Runs-test guard.** If the §2.2 \`z\` lies within ±2, streak/cluster
   "signals" are displayed descriptively only — the UI marks those states.
5. **Truncation audit.** Any window containing a truncated series segment
   contributes exposure to hazard estimates but is excluded from run-length
   statistics (prevents artificially long "current streaks").

**Reproducibility.** All statistics above are implemented in
\`src/lib/analysis.ts\` with pure functions over \`Round[]\`; the download
bundle contains this document and the code together so every number in the
UI can be recomputed offline.

---

## 8. Reading order for practitioners

1. Header stats → window state (μ, σ, n).
2. Shapes tab → is the empirical mix inside theoretical bands (§1.2)? Context
   shapes (spike/volatile/plateau/grinder) describe *how* a round arrived,
   not just where it landed (§9.1).
3. Signals tab → check the calibration multiplier before reading any signal;
   ×1.0 means realized hit rate ≈ 50% (§9.2, §10).
4. Streaks tab → runs-test z before trusting any streak (§2.2).
5. Dry zones → hazard view (§3.1); ignore "due" fallacies.
6. Moonshots → cluster baseline says bunching is normal (§4.1).
7. ETA → treat the ladder as local density, not certainty (§6).
8. Re-validate on any new feed before acting (§7).

---

## 9. Signal detection with ranges and accuracy adjustment

### 9.1 Feature-rich shape taxonomy

The source's five bands (early-crash < 1.5x, standard 1.5–2.5x, extended
2.5–5x, moonshot 5–10x, extreme > 10x) classify *magnitude only*. The
rebuild adds four context shapes computed from rolling features over a
window W = 20 (local window L = 8):

- **z-score** \`z = (m − μ_W)/σ_W\` — where the round sits in its context.
- **ratio to median** \`ρ = m/median_W\` — robust centering.
- **local volatility** \`v = σ_L/μ_L\` — round-to-round turbulence.
- **momentum** \`d = (m_t − m_{t−3})/μ_W\` — normalized 3-round drift.
- **percentile** \`p = #{m_i < m}/|W|\` — empirical rank.
- **gapSinceHigh** — rounds since the last ≥ 5x event.

Context shapes override the band classification:

| Shape | Rule (evaluated in order) | Reading |
|-------|---------------------------|---------|
| spike | \`z ≥ 2.2\` and band ∈ {extended, moonshot} | outlier burst vs rolling mean |
| volatile | \`v > 0.75\` (window ≥ 8) | turbulent local regime |
| plateau | band = standard, \`|ρ−1| ≤ 0.15\`, \`0.4 ≤ p ≤ 0.6\`, \`|d| < 0.2\` | median-locked drift |
| grinder | band = early-crash, \`m ≥ 1.2\`, \`v < 0.3\` | low-σ grind near floor |

Detector confidence is a bounded function of the features:
\`c = min(0.6 + 0.06·min(|z|,3) + 0.1·min(v,1) + 0.1·|d|, 0.98)\`.

### 9.2 Signal families, ranges and resolution

Six deterministic trigger families fire signals from the feed state. Each
signal carries **entry range** (actionable band), **target range**
(payout band that resolves a hit), **stop** (invalidation multiplier) and
**horizon** (validity in rounds). At most one signal per family is active;
resolution is mechanical:

- **hit** — a subsequent round reaches \`target.min\` within the horizon;
- **expired** — horizon elapsed with the round inside the entry band but
  below the target;
- **miss** — horizon elapsed without even entering the entry band.

| Family | Trigger | Entry | Target | Stop | Horizon |
|--------|---------|-------|--------|------|---------|
| dry-rebound | active dry zone (≥ 2 consecutive < 1.5x) | 1.5–2.5 | 2–4 | 1.2 | 6 |
| streak-continuation | current win streak ≥ 3 | 1.6–3 | 2.5–5 | 1.3 | 4 |
| moonshot-pressure | momentum ≠ weak ∧ P(moon) ≥ 55 | 1.8–6 | 5–12 | 1.4 | 10 |
| volatility-compression | \`v_L < 0.35\` ∧ all last 8 ∈ [1.1, 3] | 1.5–2.5 | 3–6 | 1.25 | 8 |
| momentum-build | \`d > 0.15\` | 0.9·m–1.4·m | 1.3·m–2·m | 0.75·m | 5 |
| floor-defend | ≥ 10/20 rounds < 1.5x | 1.2–1.8 | 2–3.5 | 1.05 | 6 |

Raw confidence per family is a bounded feature vote (e.g. dry-rebound:
\`55 + 4·min(zone length, 5)\`; momentum-build: \`45 + 60·d\`), clamped to
[0, 95]. The full range ladder (1.0x → 20x, 0.5x buckets, Laplace-smoothed
empirical probabilities) is displayed beside the families so every entry and
target band can be read against its unconditional base rate.

### 9.3 Sensitivity

A user-facing sensitivity s ∈ [0, 100] maps linearly to the firing
threshold: raw confidence must clear \`70 − 0.3·s\` (so s = 0 fires only
high-conviction signals, s = 100 fires above 40). Sensitivity also widens
target ceilings by a factor \`1 + 0.002·s\`. It tunes *recall vs precision*
only — it never alters the resolved outcome definition.

---

## 10. Accuracy adjustment (calibration loop)

Let R be the set of resolved signals and \`h = |{r ∈ R : hit}|/|R|\` the
realized hit rate. The calibration multiplier is

\`κ = clamp(0.6 + h, 0.6, 1.4)\`,

each signal's displayed confidence becomes
\`conf_adj = clamp(conf_raw · κ, 5, 97)\`, and the engine header shows κ
beside the overall hit-rate dial. Interpretation: κ = 1.0 corresponds to a
≈ 50% realized hit rate; κ < 1 discounts an over-firing engine; κ > 1
amplifies an under-firing one. The clamp bounds the influence of short
samples — a 5-signal history cannot double displayed confidence.

**Per-family accuracy.** Hit rate is also tracked per trigger family so a
family that performs below its family-specific base rate is visible in the
accuracy panel (bars labelled \`pct% (n)\`).

**Protocol for recalibration on a real feed** (replaces the simulator):
1. Accumulate ≥ 30 resolved signals before trusting κ.
2. Check per-family base rates against the range ladder (§9.2): a family
   whose hit rate sits below the unconditional probability of its target
   band carries no edge.
3. Re-run the runs-test (§2.2) before enabling streak-continuation.
4. Tune sensitivity to the operating point on the precision/recall trade
   implied by step 2, then freeze it.
`;
