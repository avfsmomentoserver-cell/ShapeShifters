# Shapeshifters — Crash Curve Analytics (source bundle)

Shape-based forecasting research terminal, rebuilt from the shapeshifters
repository (phatolafrp-pixel/shapeshifters) as a Vite + React + TypeScript app.

## What's inside
- Full app source (src/), configs, and package.json
- RESEARCH.md — the complete mathematical compendium (derivations, proofs, validation methodology)
- VALIDATION.md — machine-checked bundle report

## Run locally
```bash
bun install   # or npm install
bun run dev   # or npm run dev
```

Every statistic in the UI is implemented as a pure function in
`src/lib/analysis.ts` and can be recomputed offline from any round feed.
