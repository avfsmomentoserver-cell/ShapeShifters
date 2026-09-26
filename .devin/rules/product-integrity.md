---
description: 'Product-integrity rules: what Momento may and may not claim.'
trigger: always_on
---

# Product integrity

Momento is a measurement instrument for a game with a fixed negative expected
value. The following are defects of the highest severity, not style issues:

- Any string, label, badge, tooltip, default or preset that implies the software
  can predict the next round, time an entry, find an edge, or "turn the tables".
  Words like *signal*, *hot*, *due*, *ready*, *opportunity* applied to a future
  round are wrong unless the copy states the measured accuracy beside them.
- A model output displayed without its own measured quality — Brier skill, log
  loss, reliability, sample size, interval.
- A strategy comparison that omits turnover. Expected cost is
  `turnover × house_edge` and nothing else; a backtest that shows profit without
  showing that is broken, not lucky.
- A forecast shown as a call to bet rather than a distribution over outcomes.
- Removing or weakening the responsible-gambling surface: `/responsible`
  (`frontend/pages/Responsible.tsx`), `showResponsibleBanner`, and the
  help-line references in `README.md`.

A negative or zero result is a **correct** result and must be reported as such.
When the measured skill on an independent tape is ≤ 0, say so plainly; never
soften it into "improving", "promising" or "learning".
