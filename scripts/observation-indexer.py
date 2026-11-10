#!/usr/bin/env python3
"""Fetch public observation data for ark.observer.

Writes JSON under public/observation/ (or OBSERVATION_OUT). No secrets.
All operator and activity endpoints are supplied through ARK_OBS_* variables.
"""
from __future__ import annotations

import json, os, struct, subprocess, sys, time, hashlib, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROME = ZoneInfo("Europe/Rome")
OUT = Path(os.environ.get("OBSERVATION_OUT", Path(__file__).resolve().parents[1] / "public" / "observation"))
ARKADE = (os.environ.get("ARK_OBS_ARK_URL") or "").rstrip("/") or None
BN = (os.environ.get("ARK_OBS_ACTIVITY_URL") or "").rstrip("/") or None
BARK = (os.environ.get("ARK_OBS_BARK_URL") or "").rstrip("/") or None
MEMPOOL = os.environ.get("ARK_OBS_MEMPOOL_URL", "https://mempool.space/api").rstrip("/")
ORIGIN = os.environ.get("ARK_OBS_ORIGIN", "https://ark.observer")
# BIP341-tweaked P2TR output key derived from the Second mainnet ArkInfo
# server_pubkey 0375b2e4f6abe5b00736359de211c35d9e72b615e5fd424d8ad1e68a8b300b97b5
# (x-only 75b2e4…97b5) — verified by recomputing p2tr(internalKey) with
# @scure/btc-signer on 2026-11-07. This is the server's on-chain wallet
# address; txs touching it are its public footprint (boards, refresh
# consolidations, sweeps) — NOT proof of individual rounds or VTXOs.
BARK_SERVER_P2TR = "bc1pyj5t7f9afs2t2yyeld0fja3hswtzxwhdw3kgl0943azy02mx07fqzz2c9e"


def curl_json(url: str, timeout: int = 30):
    raw = subprocess.check_output(["curl", "-sS", "--max-time", str(timeout), url], text=True)
    return json.loads(raw)


def curl_bin(url: str, data: bytes | None = None, headers: list[str] | None = None, timeout: int = 30) -> bytes:
    cmd = ["curl", "-sS", "--max-time", str(timeout)]
    for h in headers or []:
        cmd += ["-H", h]
    if data is not None:
        cmd += ["--data-binary", "@-"]
        return subprocess.check_output(cmd + [url], input=data)
    return subprocess.check_output(cmd + [url])


def now_iso():
    return datetime.datetime.now(tz=ROME).isoformat()


def grpc_web(host: str, method: str, payload: bytes = b"") -> bytes:
    body = b"\x00" + struct.pack(">I", len(payload)) + payload
    return curl_bin(
        f"{host}/bark_server.ArkService/{method}",
        data=body,
        headers=[
            "Content-Type: application/grpc-web+proto",
            f"Origin: {ORIGIN}",
            "x-grpc-web: 1",
        ],
        timeout=25,
    )


def frames(data: bytes):
    i = 0
    msgs = []
    trail = None
    while i + 5 <= len(data):
        flags = data[i]
        ln = struct.unpack(">I", data[i + 1 : i + 5])[0]
        i += 5
        chunk = data[i : i + ln]
        i += ln
        if flags & 0x80:
            trail = chunk.decode("utf-8", "replace")
        else:
            msgs.append(chunk)
    return msgs, trail


def decode_fields(msg: bytes):
    i = 0
    out = {}

    def vi():
        nonlocal i
        x = 0
        s = 0
        while True:
            c = msg[i]
            i += 1
            x |= (c & 0x7F) << s
            if not (c & 0x80):
                return x
            s += 7

    while i < len(msg):
        tag = vi()
        fn, wt = tag >> 3, tag & 7
        if wt == 0:
            out.setdefault(fn, []).append(("v", vi()))
        elif wt == 2:
            ln = vi()
            v = msg[i : i + ln]
            i += ln
            out.setdefault(fn, []).append(("b", v))
        elif wt == 5:
            v = msg[i : i + 4]
            i += 4
            out.setdefault(fn, []).append(("i32", v))
        else:
            break
    return out


def parse_arkinfo(msg: bytes) -> dict:
    f = decode_fields(msg)
    def s(n):
        return f[n][0][1].decode() if n in f and f[n][0][0] == "b" else None
    def u(n):
        return f[n][0][1] if n in f and f[n][0][0] == "v" else None
    def hx(n):
        return f[n][0][1].hex() if n in f and f[n][0][0] == "b" else None
    return {
        "network": s(1),
        "server_pubkey": hx(2),
        "round_interval_secs": u(3),
        "nb_round_nonces": u(4),
        "vtxo_exit_delta": u(5),
        "vtxo_expiry_delta": u(6),
        "htlc_send_expiry_delta": u(7),
        "htlc_expiry_delta": u(8),
        "max_vtxo_amount": u(9),
        "required_board_confirmations": u(10),
        "max_user_invoice_cltv_delta": u(11),
        "min_board_amount": u(13),
        "mailbox_pubkey": hx(16),
        "max_vtxo_exit_depth": u(19),
        "max_offboard_inputs": u(20),
        "vtxo_lifetime": u(21) or u(6),
        "tos_link": s(22),
    }


def fetch_arkade():
    if not ARKADE:
        return {
            "fetched_at": now_iso(),
            "source": {},
            "info": None,
            "stats_24h": None,
            "trends": [],
            "recent_activity": [],
            "vtxos": [],
            "commitments": {},
            "notes": ["ARK_OBS_ARK_URL not set; operator section skipped"],
        }

    info_url = f"{ARKADE}/v1/info"
    info = curl_json(info_url)
    raw_exit_delay = info.get("unilateralExitDelay")
    # BIP68/CSV-style timelock: <512 = blocks (×600 s nominal), >=512 = seconds.
    # If the operator does not advertise it, exit_secs stays None — do NOT
    # substitute a hardcoded default; urgent/expired must then be unknown.
    exit_secs = None
    try:
        exit_delay = float(raw_exit_delay)
        exit_secs = int(exit_delay if exit_delay >= 512 else exit_delay * 600)
    except (TypeError, ValueError, OverflowError):
        pass

    stats = None
    recent = []
    trends = []
    if BN:
        stats = curl_json(f"{BN}/api/stats")
        recent = curl_json(f"{BN}/api/recent-transactions")
        try:
            trends = curl_json(f"{BN}/api/trends")
        except Exception:
            trends = []

    vtxos = []
    commitments = {}
    # Coverage accounting: each recent activity tx contributes at most the
    # first SAMPLED_VTXO_OUTPOINTS outputs to the VTXO enrichment. This is a
    # sample of recent activity, NOT a global unspent-VTXO index and NOT the
    # tx's full output set — downstream must not present these sats as totals.
    SAMPLED_VTXO_OUTPOINTS = 3
    sampled_tx_count = 0
    sampled_vtxo_count = 0
    for t in recent:
        txid = t["txid"]
        sampled_tx_count += 1
        try:
            data = curl_json(
                f"{ARKADE}/v1/indexer/vtxos?outpoints={txid}:0&outpoints={txid}:1&outpoints={txid}:2"
            )
        except Exception as error:
            vtxos.append({"txid": txid, "txType": t.get("txType"), "error": str(error)})
            continue
        for v in data.get("vtxos") or []:
            exp_raw = v.get("expiresAt")
            # SDK parseWireExpiry (chunk-JCPVP7TJ.js): n*1000 >=
            # Date.UTC(2025,0,1) → unix-seconds timestamp; smaller positive n →
            # block HEIGHT. Never treat a height as a timestamp — that would
            # mark every VTXO "expired in 1970". left_seconds/urgent/expired
            # stay unknown (None/False) for height-based expiry: computing
            # remaining time needs the chain tip, which this collector does
            # not fetch.
            EXPIRY_MIN_PLAUSIBLE_SEC = 1735689600  # Date.UTC(2025, 0, 1) / 1000
            exp_unix = None
            exp_height = None
            left = None
            try:
                n = int(exp_raw)
                if n * 1000 >= EXPIRY_MIN_PLAUSIBLE_SEC * 1000:
                    exp_unix = n if n < 1e12 else n // 1000
                    left = exp_unix - int(time.time())
                elif 0 < n < 10_000_000:  # plausible block height, not a timestamp
                    exp_height = n
            except (TypeError, ValueError, OverflowError):
                pass
            expired = left is not None and left <= 0
            urgent = (
                exit_secs is not None
                and left is not None
                and 0 < left <= exit_secs
            )
            commits = v.get("commitmentTxids") or []
            row = {
                "txType": t.get("txType"),
                "txid": v["outpoint"]["txid"],
                "vout": v["outpoint"]["vout"],
                "amount_sat": int(v.get("amount") or 0),
                "createdAt": v.get("createdAt"),
                "expiresAt": exp_raw,
                "expiresAt_unix": exp_unix,
                "expiresAtHeight": exp_height,
                "left_seconds": left,
                "urgent": urgent,
                "expired": expired,
                "isSpent": bool(v.get("isSpent")),
                "isSwept": bool(v.get("isSwept")),
                "isUnrolled": bool(v.get("isUnrolled")),
                "isPreconfirmed": bool(v.get("isPreconfirmed")),
                "spentBy": v.get("spentBy") or "",
                "settledBy": v.get("settledBy") or "",
                "commitmentTxids": commits,
                "script": v.get("script"),
                "depth": v.get("depth"),
                "arkTxid": v.get("arkTxid") or "",
                "assets": v.get("assets") or [],
            }
            vtxos.append(row)
            sampled_vtxo_count += 1
            for commitment_txid in commits[:1]:
                if commitment_txid in commitments:
                    continue
                try:
                    commitments[commitment_txid] = curl_json(
                        f"{ARKADE}/v1/indexer/commitmentTx/{commitment_txid}"
                    )
                    try:
                        tx = curl_json(f"{MEMPOOL}/tx/{commitment_txid}")
                        commitments[commitment_txid]["_onchain"] = {
                            "txid": commitment_txid,
                            "block_height": tx.get("status", {}).get("block_height"),
                            "block_time": tx.get("status", {}).get("block_time"),
                            "vout_count": len(tx.get("vout") or []),
                            "total_sats": sum(o["value"] for o in tx.get("vout") or []),
                            "mempool_url": f"{MEMPOOL.removesuffix('/api')}/tx/{commitment_txid}",
                        }
                    except Exception as error:
                        commitments[commitment_txid]["_onchain_error"] = str(error)
                except Exception as error:
                    commitments[commitment_txid] = {"error": str(error)}

    notes = [
        f"Operator info and VTXO data from {info_url} and {ARKADE}/v1/indexer.",
        (
            f"URGENT = remaining lifetime <= {exit_secs} seconds from {info_url}."
            if exit_secs is not None
            else "unilateralExitDelay not advertised by operator — URGENT/EXPIRED "
            "are unknown for this snapshot (no fallback assumed)."
        ),
        "expiresAt may be a unix timestamp OR a block height (SDK parseWireExpiry "
        "threshold Date.UTC(2025,0,1)); height-based rows carry expiresAtHeight "
        "and leave left_seconds/urgent/expired unknown — no chain tip fetched.",
    ]
    if BN:
        notes.append(
            f"Activity and 24h statistics from {BN}/api/recent-transactions and {BN}/api/stats."
        )
        notes.append(f"Activity trends from {BN}/api/trends when available.")
    else:
        notes.append("ARK_OBS_ACTIVITY_URL not set; 24h stats and recent activity enrichment skipped.")
    notes.append(f"Commitment transaction data from {MEMPOOL}/tx/<txid>.")
    return {
        "fetched_at": now_iso(),
        "source": {
            "info": info_url,
            "activity": f"{BN}/api/recent-transactions" if BN else None,
            "stats": f"{BN}/api/stats" if BN else None,
            "indexer": f"{ARKADE}/v1/indexer",
            "mempool": MEMPOOL,
        },
        "coverage": {
            # Honest scope of this snapshot — read before quoting any number.
            "vtxo_scope": (
                f"Enriched VTXOs are sampled from the first {SAMPLED_VTXO_OUTPOINTS} "
                f"outpoints (vout 0-{SAMPLED_VTXO_OUTPOINTS - 1}) of each of the "
                f"{sampled_tx_count} most recent activity transactions. This is NOT a "
                "global unspent-VTXO set and NOT each transaction's full output list; "
                "amounts below are per-VTXO values, never network totals."
            ),
            "sampled_tx_count": sampled_tx_count,
            "sampled_vtxo_count": sampled_vtxo_count,
            "sampled_vtxo_outpoints": SAMPLED_VTXO_OUTPOINTS,
            "expiry_scope": (
                "expiresAt is parsed per SDK parseWireExpiry: values >= "
                "Date.UTC(2025,0,1) are unix timestamps; smaller positives are "
                "block heights stored in expiresAtHeight. Height-based rows have "
                "left_seconds/urgent/expired = null/false (unknown) — remaining "
                "time needs the chain tip, which this collector does not fetch."
            ),
            "commitment_scope": (
                "commitments covers at most one commitment tx per sampled VTXO row "
                f"({len(commitments)} fetched); it is not an exhaustive batch list."
            ),
            "stats_scope": (
                "stats_24h comes from the configured activity API "
                f"({BN or 'not configured'}) and describes that feed's own window, "
                "not necessarily this app's sampled rows."
            ),
        },
        "info": info,
        "stats_24h": stats,
        "trends": trends[-12:],
        "recent_activity": recent,
        "vtxos": vtxos,
        "commitments": commitments,
        "notes": notes,
    }


def fetch_bark():
    if not BARK:
        return {
            "fetched_at": now_iso(),
            "source": {},
            "info": {},
            "next_round_unix": None,
            "next_round_rome": None,
            "last_round_event": None,
            "server_address_stats": None,
            "recent_server_txs": [],
            "stats_24h": None,
            "notes": ["ARK_OBS_BARK_URL not set; Second section skipped"],
        }
    msgs, _ = frames(grpc_web(BARK, "GetArkInfo"))
    info = parse_arkinfo(msgs[0]) if msgs else {}
    msgs, _ = frames(grpc_web(BARK, "NextRoundTime"))
    next_ts = None
    if msgs:
        f = decode_fields(msgs[0])
        if 1 in f:
            next_ts = f[1][0][1]
    last = None
    msgs, _ = frames(grpc_web(BARK, "LastRoundEvent"))
    if msgs:
        f = decode_fields(msgs[0])
        kind = {1: "attempt", 2: "vtxo_proposal", 4: "finished", 5: "failed"}
        k = next(iter(f.keys()), None)
        last = {"kind": kind.get(k, f"field_{k}"), "raw_field": k}
        if k == 5:
            last["round_seq"] = decode_fields(f[5][0][1]).get(1, [[None, None]])[0][1]
        if k == 4:
            fin = decode_fields(f[4][0][1])
            last["round_seq"] = fin.get(1, [[None, None]])[0][1]
            if 3 in fin:
                tx = fin[3][0][1]
                txid = hashlib.sha256(hashlib.sha256(tx).digest()).digest()[::-1].hex()
                last["funding_txid"] = txid
                last["funding_tx_bytes"] = len(tx)

    # On-chain activity around the server P2TR (public; not user-deanonymizing)
    addr_info = curl_json(f"{MEMPOOL}/address/{BARK_SERVER_P2TR}")
    txs = curl_json(f"{MEMPOOL}/address/{BARK_SERVER_P2TR}/txs")
    rows = []
    for t in txs[:40]:
        pays_to = any(o.get("scriptpubkey_address") == BARK_SERVER_P2TR for o in t.get("vout") or [])
        spends_from = any(
            (v.get("prevout") or {}).get("scriptpubkey_address") == BARK_SERVER_P2TR for v in t.get("vin") or []
        )
        bt = (t.get("status") or {}).get("block_time")
        rows.append(
            {
                "txid": t["txid"],
                "block_height": (t.get("status") or {}).get("block_height"),
                "block_time": bt,
                "block_time_rome": datetime.datetime.fromtimestamp(bt, ROME).isoformat() if bt else None,
                "vin": len(t.get("vin") or []),
                "vout": len(t.get("vout") or []),
                "total_sats": sum(o["value"] for o in t.get("vout") or []),
                "direction": "to_server" if pays_to and not spends_from else ("from_server" if spends_from else "other"),
                "mempool_url": f"{MEMPOOL.removesuffix('/api')}/tx/{t['txid']}",
            }
        )
    cut = time.time() - 86400
    day = [r for r in rows if r["block_time"] and r["block_time"] >= cut]
    grpc_url = f"{BARK}/bark_server.ArkService"
    return {
        "fetched_at": now_iso(),
        "source": {
            "grpc": grpc_url,
            "server_p2tr": BARK_SERVER_P2TR,
            "mempool": MEMPOOL,
        },
        "info": info,
        "next_round_unix": next_ts,
        "next_round_rome": datetime.datetime.fromtimestamp(next_ts, ROME).isoformat() if next_ts else None,
        "last_round_event": last,
        "server_address_stats": addr_info,
        "recent_server_txs": rows,
        "stats_24h": {
            "tx_count": len(day),
            "total_sats_out": sum(r["total_sats"] for r in day),
            "to_server": sum(1 for r in day if r["direction"] == "to_server"),
            "from_server": sum(1 for r in day if r["direction"] == "from_server"),
        },
        "notes": [
            f"Round parameters and last-round state from {grpc_url} via gRPC-web "
            "(bark_server.ArkService: GetArkInfo, NextRoundTime, LastRoundEvent).",
            f"On-chain activity fetched from {MEMPOOL}/address/{BARK_SERVER_P2TR} — "
            "the BIP341-tweaked P2TR derived from the advertised server_pubkey. "
            "Rows are transactions touching that wallet address (boards, refresh "
            "consolidations, sweeps, payments); vin/vout direction is a heuristic "
            "label, not a protocol classification. They are NOT rounds and NOT a "
            "VTXO index.",
        ],
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    arkade = fetch_arkade()
    bark = fetch_bark()
    # "urgent" in a VTXO row means "inside the unilateral-exit window". Rows
    # whose lifetime is already resolved must not count: spent (forfeited),
    # swept (operator reclaimed), unrolled (chain broken), expired, or
    # non-positive left_seconds. isPreconfirmed is NOT excluded — a
    # preconfirmed-but-unspent VTXO can still expire. This count is over the
    # SAMPLED rows only, never a network-wide figure.
    def _actionable(v: dict) -> bool:
        return not (
            v.get("isSpent")
            or v.get("isSwept")
            or v.get("isUnrolled")
            or v.get("expired")
            or (v.get("left_seconds") is not None and v.get("left_seconds") <= 0)
        )

    arkade_vtxos = arkade.get("vtxos") or []
    summary = {
        "fetched_at": now_iso(),
        "arkade_vtxos": len(arkade_vtxos),
        "arkade_urgent": sum(
            1 for v in arkade_vtxos if v.get("urgent") and _actionable(v)
        ),
        "arkade_urgent_scope": "sampled rows only — not network-wide",
        "arkade_commitments": len(arkade.get("commitments") or {}),
        "bark_next_round_rome": bark.get("next_round_rome"),
        "bark_server_txs": len(bark.get("recent_server_txs") or []),
    }
    def atomic_write(path: Path, obj: dict) -> None:
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(obj, indent=2) + "\n")
        tmp.replace(path)  # atomic on same filesystem

    atomic_write(OUT / "arkade.json", arkade)
    atomic_write(OUT / "bark.json", bark)
    atomic_write(OUT / "summary.json", summary)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
