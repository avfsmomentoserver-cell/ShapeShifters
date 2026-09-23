"""
Provably-fair verification.

This is the only part of a crash game that can be *verified* rather than
guessed. Operators commit to a hashed server seed before play, then reveal
it afterwards; the crash point of every round is a deterministic function of
(server seed, client seed, nonce), so any round can be recomputed exactly.

Stake-compatible algorithm
--------------------------
    digest = HMAC_SHA256(key=server_seed, msg=f"{client_seed}:{nonce}")
    i      = int(digest[:8], 16)                    # first 4 bytes, big-endian
    raw    = (2**32 / (i + 1)) * (1 - house_edge)
    crash  = floor(max(1.0, raw) * 100) / 100

Reference: https://provenlyfair.com/blog/verify-provably-fair-crash/

Bustabit-style algorithm
------------------------
    h = HMAC_SHA256(key=server_seed, msg=client_seed)  (or sha256 chain)
    if int(h, 16) % divisor == 0 -> instant crash at 1.00x
    else crash = floor((100 * 2**52 - X) / (2**52 - X)) / 100
         where X = int(h[:13], 16)  (52 bits)
"""
from __future__ import annotations

import hashlib
import hmac
import math
from typing import Any, Dict, List, Optional

TWO_32 = 2 ** 32
TWO_52 = 2 ** 52


# ---------------------------------------------------------------------------
# primitives
# ---------------------------------------------------------------------------

def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def hmac_sha256_hex(key: str, message: str) -> str:
    return hmac.new(key.encode(), message.encode(), hashlib.sha256).hexdigest()


def hmac_sha512_hex(key: str, message: str) -> str:
    return hmac.new(key.encode(), message.encode(), hashlib.sha512).hexdigest()


def _floor2(value: float) -> float:
    return math.floor(value * 100) / 100


# ---------------------------------------------------------------------------
# crash point derivation
# ---------------------------------------------------------------------------

# Operators agree on the primitive (HMAC-SHA256 over a seed pair) but not on how
# the message is assembled. Rather than hardcode one house's convention, expose
# the templates in use so a round can be verified against the actual operator.
MESSAGE_TEMPLATES: Dict[str, str] = {
    "client:nonce": "{client}:{nonce}",
    "client-nonce": "{client}-{nonce}",
    "nonce:client": "{nonce}:{client}",
    "clientnonce": "{client}{nonce}",
    "server:client:nonce": "{server}:{client}:{nonce}",
    "nonce-only": "{nonce}",
    "client-only": "{client}",
}
DEFAULT_TEMPLATE = "client:nonce"


def build_message(server_seed: str, client_seed: str, nonce: int,
                  template: str = DEFAULT_TEMPLATE) -> str:
    pattern = MESSAGE_TEMPLATES.get(template, template)
    return pattern.format(server=server_seed, client=client_seed, nonce=nonce)


def crash_point_stake(
    server_seed: str,
    client_seed: str,
    nonce: int,
    house_edge: float = 0.01,
    algorithm: str = "hmac_sha256",
    template: str = DEFAULT_TEMPLATE,
) -> Dict[str, Any]:
    """Stake / Spribe-style 32-bit derivation. Returns full audit trail."""
    message = build_message(server_seed, client_seed, nonce, template)
    digest = (
        hmac_sha512_hex(server_seed, message)
        if algorithm == "hmac_sha512"
        else hmac_sha256_hex(server_seed, message)
    )
    head = digest[:8]
    i = int(head, 16)
    raw = (TWO_32 / (i + 1)) * (1 - house_edge)
    crash = _floor2(max(1.0, raw))
    return {
        "algorithm": algorithm,
        "template": template,
        "message": message,
        "digest": digest,
        "first_4_bytes_hex": head,
        "integer": i,
        "integer_max": TWO_32 - 1,
        "raw": raw,
        "house_edge": house_edge,
        "instant_crash": crash <= 1.0,
        "crash_point": crash,
    }


def crash_point_bustabit(
    server_seed: str,
    client_seed: str = "",
    divisor: int = 101,
) -> Dict[str, Any]:
    """Classic Bustabit 52-bit derivation with a 1/divisor instant-bust."""
    digest = hmac_sha256_hex(server_seed, client_seed) if client_seed else sha256_hex(server_seed)
    if int(digest, 16) % divisor == 0:
        return {
            "algorithm": "bustabit",
            "digest": digest,
            "instant_crash": True,
            "crash_point": 1.0,
            "divisor": divisor,
            "house_edge": 1.0 / divisor,
        }
    x = int(digest[:13], 16)  # 52 bits
    crash = _floor2((100 * TWO_52 - x) / (TWO_52 - x) / 100)
    return {
        "algorithm": "bustabit",
        "digest": digest,
        "fifty_two_bits": x,
        "instant_crash": False,
        "crash_point": max(1.0, crash),
        "divisor": divisor,
        "house_edge": 1.0 / divisor,
    }


def verify_round(
    server_seed: str,
    client_seed: str,
    nonce: int,
    observed: Optional[float] = None,
    house_edge: float = 0.01,
    algorithm: str = "hmac_sha256",
    server_seed_hash: Optional[str] = None,
    template: str = DEFAULT_TEMPLATE,
) -> Dict[str, Any]:
    """Recompute a round and compare against what the operator displayed."""
    if algorithm == "bustabit":
        result = crash_point_bustabit(server_seed, client_seed)
    else:
        result = crash_point_stake(server_seed, client_seed, nonce, house_edge,
                                   algorithm, template)

    computed_hash = sha256_hex(server_seed)
    result["server_seed"] = server_seed
    result["client_seed"] = client_seed
    result["nonce"] = nonce
    result["computed_server_seed_hash"] = computed_hash
    result["committed_server_seed_hash"] = server_seed_hash
    result["seed_commitment_valid"] = (
        None if not server_seed_hash else computed_hash.lower() == server_seed_hash.strip().lower()
    )
    result["observed"] = observed
    if observed is None:
        result["match"] = None
    else:
        result["match"] = abs(observed - result["crash_point"]) < 0.005
    return result


def verify_batch(
    server_seed: str,
    client_seed: str,
    start_nonce: int,
    observed: List[float],
    house_edge: float = 0.01,
    algorithm: str = "hmac_sha256",
) -> Dict[str, Any]:
    """Verify a contiguous run of rounds. Any single mismatch fails the audit."""
    rows: List[Dict[str, Any]] = []
    matches = 0
    for offset, actual in enumerate(observed):
        nonce = start_nonce + offset
        r = crash_point_stake(server_seed, client_seed, nonce, house_edge, algorithm)
        ok = abs(actual - r["crash_point"]) < 0.005
        matches += int(ok)
        rows.append({
            "nonce": nonce,
            "expected": r["crash_point"],
            "observed": actual,
            "match": ok,
            "integer": r["integer"],
        })
    return {
        "rounds": len(observed),
        "matches": matches,
        "mismatches": len(observed) - matches,
        "audit_passed": matches == len(observed) and len(observed) > 0,
        "results": rows,
    }


def verify_seed_chain(revealed_seed: str, committed_hash: str, iterations: int = 1) -> Dict[str, Any]:
    """
    Hash-chain commitment check. Operators that pre-generate a chain publish
    hash^n(seed); hashing the revealed seed n times must reproduce it.
    """
    current = revealed_seed
    trail: List[str] = []
    for _ in range(max(1, iterations)):
        current = sha256_hex(current)
        trail.append(current)
    return {
        "revealed_seed": revealed_seed,
        "iterations": max(1, iterations),
        "computed_hash": current,
        "committed_hash": committed_hash.strip().lower(),
        "valid": current == committed_hash.strip().lower(),
        "trail": trail[:8],
    }


def find_chain_depth(revealed_seed: str, committed_hash: str, max_depth: int = 2000) -> Dict[str, Any]:
    """Search for how many hash iterations connect a revealed seed to a commitment."""
    target = committed_hash.strip().lower()
    current = revealed_seed
    for depth in range(1, max_depth + 1):
        current = sha256_hex(current)
        if current == target:
            return {"found": True, "depth": depth}
    return {"found": False, "depth": None, "searched": max_depth}


def generate_provable_tape(
    server_seed: str,
    client_seed: str,
    count: int = 500,
    start_nonce: int = 1,
    house_edge: float = 0.03,
) -> List[float]:
    """
    Produce a mathematically genuine crash tape from a seed pair. Used to seed
    the demo corpus so every number in the app is reproducible and auditable.
    """
    out: List[float] = []
    for n in range(start_nonce, start_nonce + count):
        out.append(crash_point_stake(server_seed, client_seed, n, house_edge)["crash_point"])
    return out


def solve_convention(
    server_seed: str,
    client_seed: str,
    nonce: int,
    observed: float,
    house_edges: Optional[List[float]] = None,
) -> Dict[str, Any]:
    """
    Which convention does this operator use?

    Given one round the player can see (server seed revealed, client seed, nonce,
    displayed crash point), search the space of message templates, hash functions
    and house edges for combinations that reproduce the number. A single match is
    weak evidence; confirm it across several rounds with verify_batch before
    trusting it.
    """
    edges = house_edges or [0.0, 0.01, 0.02, 0.03, 0.04, 0.05]
    hits: List[Dict[str, Any]] = []
    tried = 0
    for template in MESSAGE_TEMPLATES:
        for algorithm in ("hmac_sha256", "hmac_sha512"):
            for edge in edges:
                tried += 1
                r = crash_point_stake(server_seed, client_seed, nonce, edge, algorithm, template)
                if abs(r["crash_point"] - observed) < 0.005:
                    hits.append({"template": template, "pattern": MESSAGE_TEMPLATES[template],
                                 "algorithm": algorithm, "house_edge": edge,
                                 "crash_point": r["crash_point"], "message": r["message"],
                                 "digest": r["digest"]})
    bust = crash_point_bustabit(server_seed, client_seed)
    if abs(bust["crash_point"] - observed) < 0.005:
        hits.append({"template": "bustabit", "pattern": "server seed only, 52-bit, 1/101 bust",
                     "algorithm": "bustabit", "house_edge": 1 / 101,
                     "crash_point": bust["crash_point"], "message": server_seed,
                     "digest": bust.get("digest")})
    return {
        "observed": observed,
        "combinationsTried": tried + 1,
        "matches": hits,
        "conclusive": len(hits) == 1,
        "note": ("Multiple matches mean the round alone cannot distinguish the conventions. "
                 "Run a batch of consecutive rounds against each candidate to narrow it down."
                 if len(hits) > 1 else
                 "No match means this operator uses a scheme outside the tested set, the seed "
                 "pair is wrong, or the game is not provably fair in the way it claims."
                 if not hits else
                 "Exactly one convention reproduces the round. Confirm it over a batch."),
    }
