#!/usr/bin/env python3
"""noc semantic tests — the mechanisms LoCoMo can't measure.

Verifies the memory system's designed behaviors against the LIVE instance:
  T1 trigger recall     : keyword bound to memory ranks above FTS, [trigger] marker
  T2 hierarchy browse   : list_memories under noc://agent shows children
  T3 expiry lifecycle   : create with past expires_at -> read shows [expired]
  T4 alias reachability : add_alias -> read via alias uri returns same content
  T5 evolution relation : update with relation=challenge -> audit logs relation
  T6 foresight cleanup  : expired memory auto-deprecates (leaves search)
All test data is cleaned up afterwards.
"""
import json
import sys
import time
import urllib.request
import uuid

MCP_URL = "https://noc-mem.slahser.com/mcp"
TOKEN = "602b6394e06d056626a9f962f16d7776fb291f1bfdb27a3a"

PASS, FAIL = [], []
uid = uuid.uuid4().hex[:6]


def mcp(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": int(time.time() * 1000) % 100000, "method": method, "params": params}).encode()
    req = urllib.request.Request(
        MCP_URL, data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": f"Bearer {TOKEN}",
            "User-Agent": "noc-semantic-test/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def call(tool, args):
    r = mcp("tools/call", {"name": tool, "arguments": args})
    res = r.get("result", {})
    if "error" in r and r["error"]:
        return None, r["error"]
    return (res.get("content") or [{}])[0].get("text", ""), None


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'} {name} {detail}")


def cleanup(uris, trigger_keywords, audit_ids):
    for u in uris:
        try:
            call("delete_memory", {"uri": u})
        except Exception:
            pass
    for k in trigger_keywords:
        try:
            call("manage_triggers", {"action": "remove", "keyword": k})
        except Exception:
            pass
    for a in audit_ids:
        try:
            call("rollback_memory", {"audit_id": a})
        except Exception:
            pass


def main():
    print(f"noc semantic tests (uid={uid})\n")
    test_uris, test_triggers, test_audits = [], [], []

    # ---- T3/T6: expiry lifecycle -----------------------------------------
    past = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 3600))
    txt, err = call("create_memory", {"parent_uri": "noc://", "content": f"semantic expiry test {uid}", "disclosure": "temp", "priority": 4, "expires_at": past})
    uri = (txt or "").split("\n")[0].replace("Created: ", "")
    test_uris.append(uri)
    check("T3a create with expires_at", "Created:" in (txt or "") and uri, uri)

    txt, _ = call("read_memory", {"uri": uri})
    check("T3b read shows [expired]", txt and "[expired" in txt, (txt or "")[:40])

    # expired -> search should not return it
    txt, _ = call("search_memory", {"query": f"semantic expiry test {uid}"})
    check("T6 expired leaves search", not txt or uri not in (txt or ""), (txt or "")[:60])

    # ---- T1: trigger recall ----------------------------------------------
    txt, err = call("create_memory", {"parent_uri": "noc://", "content": f"semantic trigger target {uid}", "disclosure": "temp"})
    tgt = (txt or "").split("\n")[0].replace("Created: ", "")
    test_uris.append(tgt)
    kw = f"zt-sem-{uid}"
    txt, _ = call("manage_triggers", {"action": "add", "keyword": kw, "target_uri": tgt})
    test_triggers.append(kw)
    check("T1a trigger add", txt and "Trigger added" in txt, (txt or "")[:40])

    txt, _ = call("search_memory", {"query": kw})
    check("T1b trigger keyword recalls target", txt and "[trigger]" in txt and tgt in txt, (txt or "")[:80])

    # ---- T2: hierarchy browse --------------------------------------------
    txt, _ = call("list_memories", {"uri": "noc://agent", "limit": 10})
    check("T2 list_memories under noc://agent", txt and "noc://agent/" in txt, (txt or "")[:60])

    # ---- T4: alias --------------------------------------------------------
    alias = f"noc://sem_alias_{uid}"
    txt, _ = call("add_alias", {"new_uri": alias, "target_uri": tgt})
    check("T4a alias created", txt and "Alias created" in txt, (txt or "")[:50])
    txt, _ = call("read_memory", {"uri": alias})
    check("T4b read via alias returns target", txt and "semantic trigger target" in txt, (txt or "")[:50])
    test_uris.append(alias)

    # ---- T5: evolution relation -------------------------------------------
    txt, err = call("update_memory", {"uri": tgt, "append": f" relation mark {uid}", "relation": "challenge"})
    check("T5 update with relation=challenge", txt and "Updated" in txt, (txt or "")[:40])

    # ---- T5b: audit relation (via D1 query, admin API is Access-gated) ----
    import subprocess
    d1 = subprocess.run(
        ["npx", "wrangler", "d1", "execute", "noc_mem", "--remote",
         "--config", "/Users/slahser/Documents/workbuddy/Claw/usaslahser/cf-noc-mem/wrangler.local.jsonc",
         "--json", "--command", f"SELECT relation FROM audit_logs WHERE uri = '{tgt}' AND op = 'update' ORDER BY id DESC LIMIT 1"],
        capture_output=True, text=True, cwd="/Users/slahser/Documents/workbuddy/Claw/usaslahser/cf-noc-mem",
    )
    try:
        rows = json.loads(d1.stdout)
        rel = next((r for s in rows for r in s.get("results", [])), None)
        check("T5b audit records relation", rel and rel.get("relation") == "challenge", json.dumps(rel, ensure_ascii=False) if rel else "no update audit")
    except Exception as e:
        check("T5b audit records relation", False, f"{str(e)[:40]} out={d1.stdout[:80]}")

    # ---- cleanup -----------------------------------------------------------
    print("\n  cleaning up test data...")
    cleanup(test_uris, test_triggers, [])
    # wait a moment for search index to settle, then confirm gone
    time.sleep(2)
    txt, _ = call("search_memory", {"query": f"semantic {uid}"})
    gone = not txt or uid not in (txt or "")
    check("CLEANUP test data removed", gone, (txt or "")[:60])

    print(f"\n=== RESULTS: {len(PASS)} pass, {len(FAIL)} fail ===")
    if FAIL:
        print("FAILED:", ", ".join(FAIL))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
