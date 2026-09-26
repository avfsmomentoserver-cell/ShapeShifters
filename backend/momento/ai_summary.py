"""
Entrim-backed AI summary of the whole metrics surface.

The dashboard publishes a lot of separately-correct numbers — a target median, a
quantile ladder, ETAs to each magnitude, an expected-value EMA, a tail index, a
randomness verdict, an earned-skill figure. Each is honest on its own and none
of them answers "so what does all of this add up to". This module produces that
one paragraph.

Three constraints shape it, and they are the reason it is a module rather than a
few lines in a route:

  * **The key never leaves the process.** Entrim is an OpenAI-compatible
    gateway reached server-side only. The browser gets the *summary*, never the
    credential, and nothing here is importable from a frontend build.

  * **It must not invent predictive power.** The model is handed measurements
    and told, in the system prompt, that the game is unpredictable and that its
    job is to describe a distribution. It is then *audited*: `_guard()` scans
    the returned prose for forbidden claims and the verdict is published beside
    the summary. A summary that passed the guard and a summary that tripped it
    look different to the reader, and the tripped one says so out loud. This is
    the same posture as the rest of the repo — an engine figure ships with its
    own measured quality next to it.

  * **It must degrade, never break.** No key configured, gateway down, timeout,
    malformed JSON — every path returns a payload with `available: False` and a
    readable `reason`. The dashboard renders its own numbers either way; the
    summary is additive. The route is a synchronous `def`, so a blocking HTTP
    call runs in the threadpool and cannot starve `/ws/rounds`.

Config is read from the environment, falling back to a `.env` at the repo root
so a fresh clone works without exporting anything. Real environment variables
always win over the file.
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_BASE_URL = "https://api.entrim.ai/v1"
DEFAULT_MODEL = "deepseek-ai/DeepSeek-V4-Flash"

# How long a summary is reused before another call is worth making. A summary of
# slow-moving measurements does not go stale in a minute, and this is the only
# thing standing between a busy dashboard and a request per page load.
DEFAULT_TTL_S = 60.0

# Gateway budget. `DeepSeek-V4-Flash` is a *reasoning* model: it spends tokens on
# `reasoning_content` before emitting any `content`, and measured against a real
# tape it burned 899 of 900 thinking and returned an empty message with
# `finish_reason: "length"`. A budget that fits only the visible paragraph is
# therefore not a budget at all for this model — it produces nothing. 4096 leaves
# room for the measured ~2.8k reasoning pass plus the ~300-token JSON answer.
MAX_TOKENS = 4096

# A hung upstream must not hold a threadpool worker indefinitely, and a reasoning
# pass over a 1600-character digest is not fast: measured ~40 s wall time.
REQUEST_TIMEOUT_S = 120.0

_ENV_LOCK = threading.Lock()
_ENV_LOADED = False

# Claims the summary may not make. Each is a substring match against a
# lowercased copy of the model's prose. This list is deliberately about
# *implication* rather than vocabulary: "signal" alone is fine in "the model
# shows no signal", but "a signal to enter" is a call to bet.
FORBIDDEN_CLAIMS: Tuple[Tuple[str, str], ...] = (
    ("guaranteed", "claims a guaranteed outcome"),
    ("guarantee ", "claims a guaranteed outcome"),
    ("sure thing", "presents a bet as certain"),
    ("risk-free", "presents a bet as risk-free"),
    ("risk free", "presents a bet as risk-free"),
    ("will crash at", "states the next crash point as known"),
    ("next round will", "states the next round as known"),
    ("you should bet", "gives a betting instruction"),
    ("place a bet", "gives a betting instruction"),
    ("bet now", "gives a betting instruction"),
    ("beat the house", "implies the edge can be overcome"),
    ("profitable strategy", "implies a profitable strategy exists"),
    ("positive expected value", "implies a positive expected value"),
    ("safe to play", "presents play as safe"),
    ("due for", "invokes the gambler's fallacy"),
    ("overdue", "invokes the gambler's fallacy"),
    ("hot streak", "presents a streak as exploitable"),
    # The house-edge claim is the one this repository exists to refute, so it is
    # matched as a family: "an edge", "your edge", "edge over", "beat the house".
    # `AGENTS.md` §1 forbids implying the software can beat the house edge.
    #
    # Deliberately *not* included: bare "predictable", "predict the next" and
    # "win rate". An honest summary says the game is "not predictable" and that
    # there is "nothing to exploit" — a substring scan would flag those as
    # violations and drown the real ones. The phrases below cannot be flipped
    # into an honest negation, so a hit is always worth surfacing.
    ("an edge", "implies the player can beat the house edge"),
    ("your edge", "implies the player holds an exploitable edge"),
    ("edge over", "implies the player holds an exploitable edge"),
    ("advantage over the house", "implies the house can be beaten"),
    ("turn a profit", "implies a profitable outcome"),
    ("make money", "implies a profitable outcome"),
    ("exploit the", "frames a measured bias as exploitable"),
    ("the game is beatable", "claims the house can be beaten"),
)

_SYSTEM_PROMPT = """\
You are the summarising layer of Momento, an analytics terminal for crash-curve \
games (Aviator, Stake Crash, Bustabit, JetX, Spaceman).

The single most important fact about your job: a correctly implemented crash \
game is memoryless and unpredictable, and every stake has expected value \
exactly -house_edge per unit staked, at every cash-out target. You are \
describing the *measured distribution of the next round's outcome*, derived \
from the recent tape. You are not, and cannot be, calling the next round.

Write like a confident forecaster: a headline figure, the plausible range, the \
expected wait to the next big events, and what would falsify the read. Be \
direct and specific with numbers. Do not hedge every sentence.

You must not:
  - state or imply what the next round will be;
  - suggest entering, timing, or sizing a bet;
  - describe any wager as safe, guaranteed, due, or profitable;
  - claim the model has an edge over the house edge.

You must:
  - report the distribution, not a point call;
  - keep exactly one short closing line stating that this is a distribution \
over outcomes and not a betting recommendation.

Return ONLY a JSON object with these keys:
  headline        one sentence, the single most useful takeaway
  target          the central expected outcome, as a number, with units
  confidence      "low" | "medium" | "high", justified by sample size and how \
well the model has scored itself
  range           the plausible interval for the next round, as text
  moonshot        expected wait to the next 10x-class event, with its basis
  mega            expected wait to the next 50x-and-above event, with its basis
  risks           what would make this read wrong, as a short paragraph
  honesty         the one mandatory closing line described above
"""


# ---------------------------------------------------------------------------
# configuration
# ---------------------------------------------------------------------------

def _load_env_file() -> None:
    """Populate os.environ from the repo-root .env, without overriding real vars.

    Deliberately not python-dotenv: this is a dozen lines, the repo does not add
    dependencies for conveniences, and the semantics we want are stricter than
    the common library's — a variable already present in the environment must
    win, so a deployment that exports ENTRIM_API_KEY is unaffected by a stray
    file in the checkout.
    """
    global _ENV_LOADED
    with _ENV_LOCK:
        if _ENV_LOADED:
            return
        _ENV_LOADED = True
        root = Path(__file__).resolve().parents[2]
        path = root / ".env"
        if not path.is_file():
            return
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return
        for line in lines:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def _ttl_seconds() -> float:
    """Cache lifetime from `ENTRIM_TTL_S`, falling back to the default.

    A malformed value must not take the summary down, so a bad number is the
    default rather than an error. A non-positive value disables the cache
    (every read re-bills the gateway), which is worth allowing for a reader
    who is actively watching the summary move.
    """
    raw = (os.environ.get("ENTRIM_TTL_S") or "").strip()
    if not raw:
        return DEFAULT_TTL_S
    try:
        return float(raw)
    except ValueError:
        return DEFAULT_TTL_S


def config() -> Dict[str, Any]:
    """The gateway settings, read at call time so a restart is the only reload."""
    _load_env_file()
    return {
        "apiKey": os.environ.get("ENTRIM_API_KEY", "").strip(),
        "baseUrl": (os.environ.get("ENTRIM_BASE_URL") or DEFAULT_BASE_URL).strip().rstrip("/"),
        "model": (os.environ.get("ENTRIM_MODEL") or DEFAULT_MODEL).strip(),
        "ttlS": _ttl_seconds(),
    }


def available() -> bool:
    """True when a key is configured. Never returns the key itself."""
    return bool(config()["apiKey"])


# ---------------------------------------------------------------------------
# the metrics digest
# ---------------------------------------------------------------------------

def _finite(value: Any, digits: int = 4) -> Optional[float]:
    """Round a float, or drop it. `None`/NaN must not reach the prompt."""
    if value is None or isinstance(value, bool):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):   # NaN / inf
        return None
    return round(f, digits)


def build_digest(summary: Dict[str, Any], settings: Dict[str, Any]) -> Dict[str, Any]:
    """Flatten the realtime payload into the measured facts the model may use.

    Everything the model is allowed to say comes from here, so this is also the
    whitelist: no free-form input reaches the prompt, and no field is invented.
    Numbers are rounded at this boundary rather than in the prompt string, so a
    long float tail cannot eat the budget or hint at false precision.
    """
    rt = summary.get("realtime") or {}
    baseline = summary.get("baseline") or {}
    heavy = baseline.get("payload") or {}
    delta = summary.get("delta") or {}

    etas: Dict[str, Any] = {}
    for key, row in (rt.get("allEtas") or {}).items():
        if isinstance(row, dict):
            etas[key] = {"rounds": _finite(row.get("eta"), 2), "note": row.get("note")}

    exceed = rt.get("exceedance") or {}
    randomness = heavy.get("randomness") or {}
    overall = randomness.get("overall") or {}
    skill = heavy.get("skill") or heavy.get("earnedSkill") or {}

    return {
        "houseEdge": _finite(settings.get("houseEdge"), 4),
        "operator": settings.get("operator"),
        "roundsOnTape": _finite(rt.get("rounds"), 0),
        "windowUsed": _finite(rt.get("window"), 0),
        "tailIndex": _finite(rt.get("tailAlpha")),
        "target": rt.get("target") or {},
        "intervals": rt.get("intervals") or {},
        "quantiles": rt.get("quantiles") or {},
        "expectedValuePerUnit": (rt.get("expectedValue") or {}).get("ema"),
        "expectedValueDrift": (rt.get("expectedValue") or {}).get("deltaPerRound"),
        "waitToMagnitude": etas,
        "exceedanceVerdict": exceed.get("verdict"),
        "randomnessVerdict": overall.get("verdict"),
        "randomnessSummary": overall.get("summary"),
        "earnedSkill": skill.get("skill") if isinstance(skill, dict) else None,
        "liveVsScheduled": {
            "roundsApart": delta.get("roundsApart"),
            "medianDrift": delta.get("medianDrift"),
            "tailIndexDrift": delta.get("tailAlphaDrift"),
            "moved": delta.get("moved"),
        },
        "scheduledPassFresh": baseline.get("fresh"),
        "scheduledPassAgeMs": baseline.get("ageMs"),
    }


# ---------------------------------------------------------------------------
# the honesty guard
# ---------------------------------------------------------------------------

def _guard(text: str) -> Dict[str, Any]:
    """Audit the model's prose for claims it is not allowed to make.

    A substring scan, deliberately: it is cheap, it is explainable, and it fails
    loudly rather than trying to be clever about intent. The result is published
    rather than used to silently rewrite the text — a reader is entitled to know
    that the summary tripped the check, not to be handed a laundered version
    that hides the fact the model tried.
    """
    haystack = (text or "").lower()
    hits: List[Dict[str, str]] = []
    for needle, why in FORBIDDEN_CLAIMS:
        if needle in haystack:
            hits.append({"phrase": needle, "why": why})
    return {"passed": not hits, "violations": hits}


# ---------------------------------------------------------------------------
# the call
# ---------------------------------------------------------------------------

_CACHE: Dict[str, Dict[str, Any]] = {}
_CACHE_LOCK = threading.Lock()


# A summary describes a slow-moving statistical picture, so re-asking a
# reasoning model about it on every round is not viable: one measured call takes
# ~40 s, and the tape grows faster than that. Reuse is therefore governed by the
# TTL, and the tape fingerprint only has to be coarse enough to notice that the
# picture has genuinely moved — this is the width of that bucket, in rounds.
SUMMARY_ROUND_BUCKET = 25


def _cache_key(summary: Dict[str, Any]) -> str:
    """A cheap fingerprint of *which tape* a summary describes.

    Deliberately coarse. Keying this on the exact revision or round count makes
    the key differ on every single round — measured: `1:800:1.0881` then
    `2:800:1.0881` for two calls over an unchanged tape — which defeats the TTL
    entirely and spends a 40-second model call per round. The round count is
    bucketed and paired with the fitted tail index, so ordinary growth reuses the
    cached prose while a replaced tape (a reseed, which moves the count and the
    tail) does not.
    """
    rt = summary.get("realtime") or {}
    rounds = int(rt.get("rounds") or 0)
    bucket = rounds // SUMMARY_ROUND_BUCKET
    alpha = rt.get("tailAlpha")
    return f"{bucket}:{rounds > 0}:{alpha}"


def _post(cfg: Dict[str, Any], messages: List[Dict[str, str]]) -> Dict[str, Any]:
    """One chat-completions call. Imported lazily so the module loads without httpx."""
    import httpx

    resp = httpx.post(
        f"{cfg['baseUrl']}/chat/completions",
        headers={
            "Authorization": f"Bearer {cfg['apiKey']}",
            "Content-Type": "application/json",
        },
        json={
            "model": cfg["model"],
            "messages": messages,
            "max_tokens": MAX_TOKENS,
            "temperature": 0.2,
        },
        timeout=REQUEST_TIMEOUT_S,
    )
    if resp.status_code >= 400:
        # Body only — never echo the request headers back into an error.
        raise RuntimeError(f"gateway returned {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def _extract(payload: Dict[str, Any]) -> str:
    """Pull the assistant text out of an OpenAI-compatible response.

    A *reasoning* model (DeepSeek-V4-Flash and friends) puts its thinking in
    `reasoning_content` and only then writes `content`. When the token budget
    runs out mid-thought, `content` is empty and `finish_reason` is `length` —
    which looks like a malformed gateway response but is really "the budget was
    smaller than the reasoning pass". That distinction is reported, because the
    two have different fixes.
    """
    choices = payload.get("choices") or []
    if not choices:
        raise RuntimeError("gateway returned no choices")
    choice = choices[0]
    message = choice.get("message") or {}
    content = message.get("content")
    if isinstance(content, list):                      # some gateways emit parts
        content = "".join(
            part.get("text", "") for part in content if isinstance(part, dict))
    if not isinstance(content, str) or not content.strip():
        reasoning = message.get("reasoning_content") or ""
        if choice.get("finish_reason") == "length" and reasoning:
            raise RuntimeError(
                f"the model spent the whole {MAX_TOKENS}-token budget on reasoning "
                f"({len(reasoning)} chars) and returned no answer — raise MAX_TOKENS "
                f"or choose a non-reasoning ENTRIM_MODEL")
        raise RuntimeError("gateway returned an empty message")
    return content.strip()


def _parse(text: str) -> Tuple[Optional[Dict[str, Any]], str]:
    """Best-effort JSON. A prose answer is still useful, so it is not an error."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        # Strip a fenced block without assuming the tag is exactly `json`.
        cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.rstrip().endswith("```"):
            cleaned = cleaned.rstrip()[:-3]
    try:
        parsed = json.loads(cleaned)
    except (ValueError, TypeError):
        return None, text
    if not isinstance(parsed, dict):
        return None, text
    return parsed, (parsed.get("headline") or text)


def summarize(visitor: str, summary: Dict[str, Any], settings: Dict[str, Any],
              force: bool = False) -> Dict[str, Any]:
    """Return the AI summary for the current metrics, or a degraded payload.

    Never raises. Every failure mode is reported as `available: False` with a
    `reason`, because the caller is a dashboard that must keep rendering.
    """
    rt = summary.get("realtime") or {}
    if not rt.get("rounds"):
        return {"available": False, "reason": "no tape yet", "summary": None}

    cfg = config()
    if not cfg["apiKey"]:
        return {
            "available": False,
            "reason": "no ENTRIM_API_KEY configured — set it in .env or the environment",
            "model": cfg["model"],
        }

    key = _cache_key(summary)
    now = time.time()
    ttl = cfg.get("ttlS", DEFAULT_TTL_S)
    if not force:
        with _CACHE_LOCK:
            hit = _CACHE.get(visitor)
        # `ttl <= 0` disables reuse, which is what an operator watching the
        # summary move wants and the only reading of "expire immediately".
        if ttl > 0 and hit and hit["key"] == key and (now - hit["at"]) <= ttl:
            return {**hit["payload"], "cached": True}

    digest = build_digest(summary, settings)
    user = (
        "Current measurements from the tape. Every figure is derived from the "
        "recent window and carries its own sample size. Summarise what they add "
        "up to, for a reader deciding what to look at next.\n\n"
        + json.dumps(digest, indent=1, sort_keys=True, default=str)
    )

    started = time.perf_counter()
    try:
        raw = _post(cfg, [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ])
        text = _extract(raw)
    except Exception as exc:                            # noqa: BLE001 — degrade, never raise
        return {
            "available": False,
            "reason": f"gateway call failed: {type(exc).__name__}: {exc}"[:400],
            "model": cfg["model"],
        }

    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    parsed, prose = _parse(text)
    guard = _guard(json.dumps(parsed, default=str) if parsed else text)

    payload: Dict[str, Any] = {
        "available": True,
        "model": cfg["model"],
        "elapsedMs": elapsed_ms,
        "rounds": rt.get("rounds"),
        "revision": summary.get("revision"),
        "summary": parsed,
        # Hoisted so the dashboard can render the headline without reaching into
        # a shape that is None whenever the model answered in prose instead.
        "headline": (parsed or {}).get("headline"),
        "text": prose,
        "guard": guard,
        "cached": False,
    }
    with _CACHE_LOCK:
        _CACHE[visitor] = {"key": key, "at": now, "payload": payload}
    return payload
