"""Contracts for the Entrim-backed overall summary.

The summary sits on a dashboard that must keep rendering, and it carries this
repository's overriding rule: it may describe a distribution but never imply a
usable edge. Both properties are tested here without ever calling the network.
"""
from __future__ import annotations

import json
import random

import pytest

from momento import ai_summary, realtime


def fair_tape(n: int = 500, house_edge: float = 0.03, seed: int = 5) -> list:
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        u = rng.random()
        out.append(1.0 if u > (1 - house_edge) else (1 - house_edge) / max(u, 1e-9))
    return out


@pytest.fixture()
def composed() -> dict:
    return realtime.summary("ai-fixture", fair_tape(500), 0.03)


# ---------------------------------------------------------------- copy integrity

@pytest.mark.parametrize("claim", [
    "the next round will hit",
    "guaranteed profit",
    "you have an edge",
    "a sure thing",
    "beat the house",
])
def test_guard_flags_a_claim_this_repo_forbids(claim):
    """Every phrase that implies a knowable next round must trip the guard."""
    verdict = ai_summary._guard(f"Analysis: {claim.upper()}.")
    assert verdict["passed"] is False
    assert verdict["violations"], "a violation must name the offending phrase"


def test_guard_accepts_a_measurement_of_the_past_tape():
    text = ("The recent 2x rate is 0.41 against a fair 0.485 over 600 rounds. "
            "This is a description of the past tape, not a forecast.")
    assert ai_summary._guard(text)["passed"] is True


def test_guard_does_not_flag_the_honest_negative_result():
    """The product *is* the negative result — it must not read as a violation."""
    honest = ("The game is not predictable: no measured bias survives the randomness "
              "battery, there is nothing to exploit, and every stake carries an expected "
              "value of -h x stake. The model's Brier skill is 0.001, indistinguishable "
              "from the fair baseline.")
    assert ai_summary._guard(honest)["passed"] is True


def test_guard_is_case_insensitive():
    assert ai_summary._guard("NEXT ROUND WILL be bigger")["passed"] is False


# -------------------------------------------------------------------- the digest

def test_digest_carries_every_tier_and_is_json_serialisable(composed):
    digest = ai_summary.build_digest(composed, {"houseEdge": 0.03, "operator": "aviator"})
    # Must survive a round trip to the gateway.
    assert json.loads(json.dumps(digest, default=str))

    # The two tiers, and the figures that only the scheduled pass knows.
    assert digest["roundsOnTape"] == composed["realtime"]["rounds"]
    assert digest["houseEdge"] == 0.03
    assert digest["operator"] == "aviator"
    for key in ("target", "quantiles", "waitToMagnitude", "tailIndex",
                "randomnessVerdict", "randomnessSummary", "earnedSkill",
                "liveVsScheduled", "scheduledPassFresh"):
        assert key in digest, f"the summary must be told {key}"


def test_digest_never_invents_a_number_the_engine_did_not_measure(composed):
    """A missing figure must surface as None, not as a plausible default."""
    stripped = {"realtime": composed["realtime"], "baseline": {}, "delta": {}}
    digest = ai_summary.build_digest(stripped, {})
    # Nothing to report is reported as nothing, not as 0.
    assert digest["randomnessVerdict"] is None
    assert digest["roundsOnTape"] == composed["realtime"]["rounds"]


# ---------------------------------------------------------------------- responses

def test_parse_accepts_fenced_json_and_prose():
    parsed, headline = ai_summary._parse('```json\n{"headline": "H", "body": ["a"]}\n```')
    assert parsed["headline"] == "H"
    assert headline == "H"

    # A prose answer is not an error: it is still a summary.
    parsed, prose = ai_summary._parse("Just a paragraph of analysis.")
    assert parsed is None
    assert prose == "Just a paragraph of analysis."


def test_extract_reads_an_openai_compatible_response():
    assert ai_summary._extract({"choices": [{"message": {"content": " hi "}}]}) == "hi"
    # Some gateways emit content as parts.
    parts = {"choices": [{"message": {"content": [{"text": "a"}, {"text": "b"}]}}]}
    assert ai_summary._extract(parts) == "ab"
    with pytest.raises(RuntimeError):
        ai_summary._extract({"choices": []})


def test_summarize_degrades_without_an_api_key(composed, monkeypatch):
    """No key is a state, not a crash — the dashboard must still render."""
    monkeypatch.delenv("ENTRIM_API_KEY", raising=False)
    monkeypatch.setattr(ai_summary, "_CACHE", {})
    monkeypatch.setattr(ai_summary, "config", lambda: {
        "apiKey": "", "baseUrl": ai_summary.DEFAULT_BASE_URL, "model": ai_summary.DEFAULT_MODEL})

    out = ai_summary.summarize("no-key", composed, {"houseEdge": 0.03})
    assert out["available"] is False
    assert "ENTRIM_API_KEY" in out["reason"]


def test_summarize_degrades_when_the_gateway_fails(composed, monkeypatch):
    monkeypatch.setattr(ai_summary, "config", lambda: {
        "apiKey": "sk-test", "baseUrl": ai_summary.DEFAULT_BASE_URL, "model": "m"})
    monkeypatch.setattr(ai_summary, "_CACHE", {})

    def boom(cfg, messages):
        raise RuntimeError("gateway returned 502: upstream")

    monkeypatch.setattr(ai_summary, "_post", boom)
    out = ai_summary.summarize("gw-fail", composed, {"houseEdge": 0.03}, force=True)
    assert out["available"] is False
    assert "502" in out["reason"], "the failure reason must survive to the reader"


def test_summarize_reports_the_guard_verdict_on_a_violating_answer(composed, monkeypatch):
    """A model that breaks the rule is published, not silently laundered."""
    monkeypatch.setattr(ai_summary, "config", lambda: {
        "apiKey": "sk-test", "baseUrl": ai_summary.DEFAULT_BASE_URL, "model": "m"})
    monkeypatch.setattr(ai_summary, "_CACHE", {})
    monkeypatch.setattr(ai_summary, "_post", lambda cfg, messages: {
        "choices": [{"message": {"content": json.dumps(
            {"headline": "Bet now", "body": ["the next round will hit"]})}}]})

    out = ai_summary.summarize("violating", composed, {"houseEdge": 0.03}, force=True)
    assert out["available"] is True
    assert out["guard"]["passed"] is False
    assert out["guard"]["violations"]


def test_summarize_caches_a_successful_answer(composed, monkeypatch):
    monkeypatch.setattr(ai_summary, "config", lambda: {
        "apiKey": "sk-test", "baseUrl": ai_summary.DEFAULT_BASE_URL, "model": "m"})
    monkeypatch.setattr(ai_summary, "_CACHE", {})
    calls = []

    def counted(cfg, messages):
        calls.append(1)
        return {"choices": [{"message": {"content": json.dumps({"headline": "ok"})}}]}

    monkeypatch.setattr(ai_summary, "_post", counted)
    first = ai_summary.summarize("cache-visitor", composed, {"houseEdge": 0.03}, force=True)
    second = ai_summary.summarize("cache-visitor", composed, {"houseEdge": 0.03})
    assert first["cached"] is False
    assert second["cached"] is True
    assert len(calls) == 1, "the second read must not re-bill the gateway"


def test_summarize_reports_no_tape_rather_than_calling_out(composed, monkeypatch):
    monkeypatch.setattr(ai_summary, "config", lambda: {
        "apiKey": "sk-test", "baseUrl": ai_summary.DEFAULT_BASE_URL, "model": "m"})
    monkeypatch.setattr(ai_summary, "_CACHE", {})
    calls = []
    monkeypatch.setattr(ai_summary, "_post", lambda cfg, m: calls.append(1) or {})

    out = ai_summary.summarize("empty", {"realtime": {"rounds": 0}}, {})
    assert out["available"] is False
    assert calls == [], "an empty tape must not spend a request"


def test_ttl_defaults_when_unset_or_unparseable(monkeypatch):
    """A missing or malformed ENTRIM_TTL_S is the default, never an error."""
    monkeypatch.delenv("ENTRIM_TTL_S", raising=False)
    assert ai_summary.config()["ttlS"] == ai_summary.DEFAULT_TTL_S
    monkeypatch.setenv("ENTRIM_TTL_S", "not-a-number")
    assert ai_summary.config()["ttlS"] == ai_summary.DEFAULT_TTL_S
    monkeypatch.setenv("ENTRIM_TTL_S", "12.5")
    assert ai_summary.config()["ttlS"] == 12.5


def test_configuring_a_zero_ttl_disables_cache_reuse(composed, monkeypatch):
    """`ENTRIM_TTL_S=0` must re-bill rather than serve a cached paragraph."""
    monkeypatch.setattr(ai_summary, "_CACHE", {})
    calls = []

    def counted(cfg, messages):
        calls.append(1)
        return {"choices": [{"message": {"content": json.dumps({"headline": "ok"})}}]}

    monkeypatch.setattr(ai_summary, "_post", counted)
    monkeypatch.setattr(ai_summary, "config", lambda: {
        "apiKey": "sk-test", "baseUrl": ai_summary.DEFAULT_BASE_URL, "model": "m", "ttlS": 0.0})

    first = ai_summary.summarize("ttl-off", composed, {"houseEdge": 0.03}, force=True)
    second = ai_summary.summarize("ttl-off", composed, {"houseEdge": 0.03})
    assert first["cached"] is False
    assert second["cached"] is False, "a zero TTL must not reuse the cached payload"
    assert len(calls) == 2


def test_status_never_exposes_the_key(monkeypatch):
    """`/stats/ai-status` is safe to hand to the browser."""
    monkeypatch.setenv("ENTRIM_API_KEY", "sk-secret-value")
    monkeypatch.setattr(ai_summary, "_ENV_LOADED", False)
    status = ai_summary.config()
    payload = json.dumps({"configured": bool(status["apiKey"]), "model": status["model"]})
    assert "sk-secret-value" not in payload
