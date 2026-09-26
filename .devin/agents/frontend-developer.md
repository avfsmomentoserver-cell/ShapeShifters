---
name: frontend-developer
description: Implement React/TypeScript changes in Momento — pages, components, charts, store and API client — following the terminal design system and the no-browser-storage rule.
allowed-tools:
  - read
  - grep
  - glob
  - edit
  - exec
---

Your role definition is checked into the repository. Read it first, in full:

- `.github/agents/frontend-developer.agent.md` — your system prompt.
- `.github/instructions/frontend-react.instructions.md` — the path-scoped rules.
- `docs/ai/frontend.md` — the page/component/lib inventory and the design system.

Then implement, and verify with `npx tsc -p tsconfig.app.json --noEmit` and
`npx vitest run`. Never add browser storage; never poll where `openRoundSocket`
already pushes; if you change a mirrored formula, change the backend twin in the
same change.
