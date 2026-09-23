# Setup free model providers for Copilot Chat

# Setup free model providers for Copilot Chat

## Goal
Get working, free LLM models inside VS Code Copilot Chat using the already-installed `johnny-zhao.oai-compatible-copilot` extension, pointed at Google AI Studio (Gemini free tier) — the most generous indefinite free tier (no card, no expiration, 10–15 RPM / 1,500 req/day on Flash models).

## Findings (from research + workspace audit)
- Extensions already installed: `oai-compatible-copilot` (OpenAI-compatible provider bridge for Copilot Chat), `mistral-ai-copilot-chat`, `huggingface-vscode-chat`, `vscode-codeqwen-copilot`.
- Free options (2026): **Google AI Studio / Gemini** (best: 1,500 req/day, 1M ctx, multimodal, no card, no expiry), **Mistral La Plateforme** (free tier, but the user's pasted key returned persistent HTTP 429), **Groq** (free tier, Llama 3.3 70B), **OpenRouter** (free-model routes, ~50 req/day), **Hugging Face router** (monthly inference credits), plus keyless options (Pollinations, OVHcloud, Kilo).
- The user's Mistral key (`6IkE8...`) is rate-limited/quota-exhausted; not usable right now.
- VS Code stores extension secrets in encrypted storage — the API key must be entered via the UI command **"OAI Compatible Copilot: Set OAI Compatible Apikey"**, not from settings.json.

## Steps

1. **Write VS Code user settings** (`~/.config/Code/User/settings.json`) so the OAI-compatible provider points at Google AI Studio and declares free models:
   - `oaicopilot.baseUrl` = `https://generativelanguage.googleapis.com/v1beta/openai/`
   - `oaicopilot.models`:
     - `gemini-2.0-flash` — "Gemini 2.0 Flash (Free)", 15 RPM / 1,500 RPD, 1M ctx
     - `gemini-2.5-flash` — "Gemini 2.5 Flash (Free)", 10 RPM / 1,500 RPD, 1M ctx
     - `gemini-2.5-flash-lite` — "Gemini 2.5 Flash-Lite (Free)", highest RPM
     - `gemini-2.5-pro` — "Gemini 2.5 Pro (Free)", 50 RPD (spare-use)
   - Vision enabled on 2.0/2.5 Flash (multimodal free).
2. **Persist the API key where possible**: try VS Code secret storage via CLI is not available; instead write the key to a local untracked file (`.vscode/free-api-key.local.md` or similar) so the user can paste it once via the command palette, OR configure via the extension's "Open Configuration UI".
3. **Add Groq as a secondary free provider** in the same models array (per-model `baseUrl: https://api.groq.com/openai/v1`, model `llama-3.3-70b-versatile`) so there is failover when Gemini's RPM cap is hit. Groq key also entered via the same Apikey command (multi-provider mode supported: `Set OAI Compatible Multi-Provider Apikey`).
4. **Verify**: after the user reloads the window and pastes the key via **Set OAI Compatible Apikey**, confirm models appear in Copilot Chat's model picker under the "oai-compatible" vendor.
5. **Fallbacks documented**: Mistral key currently 429 — retry later or regenerate at console.mistral.ai; OpenRouter `:free` models as another spare.

## Risks / notes
- Google free tier uses data for training (fine for this workspace; avoid for sensitive code).
- 2.5 Pro is only 50 req/day — treat as bonus, not default.
- Keys cannot be set programmatically (encrypted secret storage); user interaction required for the one-time paste.
