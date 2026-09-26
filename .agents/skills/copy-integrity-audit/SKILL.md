---
name: copy-integrity-audit
description: Audit user-facing copy, labels and defaults in Momento for language that implies predictive power or a betting edge, or that omits the measured quality of a model figure. Use before shipping UI text, and when a screen "feels like a signal".
allowed-tools:
  - read
  - grep
  - glob
---

# Copy integrity audit

Momento is a gambling-analytics terminal whose entire product claim is honesty:
it measures whether a tape is independent and scores its own forecasts, and the
expected answer is that it has no edge. Copy that implies otherwise is not a
wording nit — it is the highest-severity class of defect in this project, and it
can cause real financial harm to a real user.

## The line

**Forbidden framings:** signal, alert as advice, "due", "overdue", "hot",
"cold is about to break", "prime time", "best hour to play", "next round will",
"guaranteed", "high confidence win", "the model predicts", "beat the house",
"recover losses", "martingale works", any profit/return figure without the
matching turnover cost.

**Required framings:** descriptive of the past tape; every model figure shown
next to its measured quality (Brier skill, log loss, reliability, sample size);
every rate carrying its `n` and, where available, its interval; the standing
statement that a correctly implemented crash game is unpredictable and every
stake has expected value `-h × stake`, independent of target.

Terms that are correct in this codebase and should not be "fixed":
*pressure*, *radar*, *DNA*, *ladder*, *moonshot*, *regime* — these are names of
**descriptive** engines, and each one's measured accuracy is displayed beside
it. A name is only a problem when the surrounding copy asserts a predictive
claim the measurement contradicts.

## Where to look

```bash
# the honesty surfaces — these must stay, and must stay honest
frontend/pages/Responsible.tsx
frontend/pages/Docs.tsx            # the published method; the reference statement
frontend/pages/Accuracy.tsx
frontend/pages/Randomness.tsx
frontend/pages/Skill.tsx
frontend/pages/Exceedance.tsx
frontend/pages/Phases.tsx
```

Then the model-facing surfaces: `Dashboard`, `Feed`, `Windows`, `EngineView`
and everything under `components/` that renders a probability, an ETA, a
"confidence", or a ranked list.

Grep the vocabulary, then read the surrounding paragraph — the phrase alone is
not the finding, the claim it makes in context is:

```bash
grep -rniE "signal|due for|guaranteed|can't lose|hot|best (time|hour)|predict" \
  frontend/pages frontend/components
```

Also audit **defaults**, not just text: the default target, the default stake,
the bankroll defaults, `showResponsibleBanner`, and any place a ranked list is
presented without its accuracy.

## Checks

1. Does any string assert or imply that the next round is knowable?
2. Is every probability shown with the sample size it was estimated from?
3. Is every engine's measured skill displayed next to the engine's output —
   including when that skill is zero or negative?
4. Does any strategy comparison omit turnover, making a staking plan look
   favourable?
5. Are the responsible-gambling surface and banner intact and reachable?
6. Does `/docs` still agree with the code? `Docs.tsx` is the project's public
   statement of method; if the maths moved, it must move too.
7. Could a reasonable user read the screen and conclude they have an edge? If
   yes, that is the finding.

## Report

Quote the exact string and its `path:line`, then state what it implies and what
the code actually supports. Propose a replacement that states the measurement
instead of hiding it. Never soften a finding because the copy is "just a label".
