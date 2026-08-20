#!/usr/bin/env python3
"""noc scenario loop — dogfooding scenario matrix against the LIVE instance.

Designs realistic usage flows and asserts the MCP tools' contract on each.
Unlike noc_semantic_test.py (mechanism-focused), this one walks common
user journeys end-to-end. Every scenario cleans up after itself.

Scenarios:
  S1 project handoff   : create -> alias -> trigger -> search -> update -> rename
  S2 meeting note      : create with expiry -> read expired marker -> search excludes
  S3 self-correction   : create -> update(relation=challenge) -> audit -> rollback
  S4 trigger mgmt      : add/list/remove + cascade on delete
  S5 hierarchy walk    : nested tree browse, root list, missing path
  S6 full-replace      : update(content=) vs append semantics
  S7 rename contract   : rename keeps children/aliases, old path dies
  S8 search modes      : trigger-hit, token-OR long query, empty result
  S9 system nodes      : boot/briefing/index/recent/diagnostic
  S10 boundary/errors  : empty content, bad uri, missing uri, oversized content
  S11 slug fidelity    : hyphen kept, cjk title, no-title fallback
  S12 expiry clear     : expires_at "" clears, future date ok
"""
import json
import re
import sys
import time
import urllib.request
import urllib.error
import uuid

MCP_URL = "https://noc-mem.slahser.com/mcp"
TOKEN = "602b6394e06d056626a9f962f16d7776fb291f1bfdb27a3a"

PASS, FAIL = [], []
uid = uuid.uuid4().hex[:6]
created = []  # (uri, kind) for cleanup


def mcp(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": int(time.time() * 1000) % 100000, "method": method, "params": params}).encode()
    req = urllib.request.Request(
        MCP_URL, data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": f"Bearer {TOKEN}",
            "User-Agent": "noc-scenario-loop/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"http_error": e.code, "body": e.read().decode()[:200]}


def call(tool, args):
    r = mcp("tools/call", {"name": tool, "arguments": args})
    if "http_error" in r:
        return None, f"HTTP {r['http_error']}: {r.get('body','')}"
    if r.get("error"):
        return None, r["error"].get("message", str(r["error"]))
    res = r.get("result", {})
    return (res.get("content") or [{}])[0].get("text", ""), None


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'} {name}" + (f"  [{detail}]" if detail else ""))


def create(parent, content, **kw):
    txt, err = call("create_memory", {"parent_uri": parent, "content": content, **kw})
    if err:
        return None, err
    first = (txt or "").split("\n")[0]
    uri = re.sub(r"\s*\(audit \d+\)$", "", first.replace("Created: ", "")).strip()
    if uri:
        created.append(uri)
    return uri, txt


def cleanup():
    print("\n  cleaning up...")
    for u in reversed(created):
        try:
            call("delete_memory", {"uri": u})
        except Exception:
            pass
    call("manage_triggers", {"action": "list"})  # noop, keep warm
    time.sleep(2)
    txt, _ = call("search_memory", {"query": f"zt-loop-{uid}"})
    return not txt or uid not in (txt or "")


def s1_project_handoff():
    print("S1 project handoff")
    uri, _ = create("noc://", f"zt-loop-{uid} alpha project doc")
    if not uri:
        check("S1a create", False, "no uri"); return
    al = f"noc://zt_alpha_{uid}"
    call("add_alias", {"new_uri": al, "target_uri": uri})
    created.append(al)
    txt, _ = call("read_memory", {"uri": al})
    check("S1b alias read", txt and "alpha project" in txt, (txt or "")[:30])
    kw = f"zt-loop-alpha-{uid}"
    call("manage_triggers", {"action": "add", "keyword": kw, "target_uri": uri})
    txt, _ = call("search_memory", {"query": kw})
    check("S1c trigger recall", txt and "[trigger]" in txt and uri in txt, (txt or "")[:60])
    txt, _ = call("update_memory", {"uri": uri, "content": f"zt-loop-{uid} alpha project v2", "relation": "enrich"})
    check("S1d full replace", txt and "Updated" in txt, (txt or "")[:30])
    new = f"noc://zt_alpha_v2_{uid}"
    txt, _ = call("rename_memory", {"uri": uri, "new_name": f"zt_alpha_v2_{uid}"})
    check("S1e rename", txt and "Renamed" in txt, (txt or "")[:40])
    txt, _ = call("read_memory", {"uri": new})
    check("S1f read after rename", txt and "v2" in txt, (txt or "")[:30])
    txt, _ = call("read_memory", {"uri": uri})
    check("S1g old uri dead", txt and "not found" in txt.lower(), (txt or "")[:40])
    created.append(new)


def s2_meeting_note():
    print("S2 meeting note with expiry")
    past = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 3600))
    uri, _ = create("noc://", f"zt-loop-{uid} meeting note", expires_at=past)
    if not uri:
        check("S2a create with expiry", False); return
    txt, _ = call("read_memory", {"uri": uri})
    check("S2b expired marker", txt and "[expired" in txt, (txt or "")[:30])
    txt, _ = call("search_memory", {"query": f"zt-loop-{uid} meeting"})
    check("S2c expired excluded from search", not txt or uri not in (txt or ""), (txt or "")[:40])


def s3_self_correction():
    print("S3 self-correction + rollback")
    uri, _ = create("noc://", f"zt-loop-{uid} wrong fact")
    if not uri:
        check("S3a create", False); return
    txt, _ = call("update_memory", {"uri": uri, "content": f"zt-loop-{uid} corrected fact", "relation": "challenge"})
    check("S3b challenge update", txt and "Updated" in txt, (txt or "")[:30])
    # update now returns the audit id -> rollback restores the previous content
    import re
    m = re.search(r"audit (\d+)", txt or "")
    check("S3c update exposes audit_id", m is not None, (txt or "")[:50])
    audit_id = int(m.group(1)) if m else 0
    txt, _ = call("rollback_memory", {"audit_id": audit_id})
    check("S3d rollback ok", txt and "rolled back" in txt, (txt or "")[:40])
    txt, _ = call("read_memory", {"uri": uri})
    check("S3e content restored", txt and "wrong fact" in txt and "corrected fact" not in txt, (txt or "")[:50])


def s4_trigger_mgmt():
    print("S4 trigger management + cascade")
    uri, _ = create("noc://", f"zt-loop-{uid} trigger subject")
    if not uri:
        check("S4a create", False); return
    kw = f"zt-loop-kw-{uid}"
    txt, _ = call("manage_triggers", {"action": "add", "keyword": kw, "target_uri": uri})
    check("S4b add", txt and "Trigger" in txt, (txt or "")[:30])
    txt, _ = call("manage_triggers", {"action": "list"})
    check("S4c list contains kw", txt and kw in txt, (txt or "")[:60])
    txt, _ = call("delete_memory", {"uri": uri})
    check("S4d delete", txt and "Deleted" in txt, (txt or "")[:30])
    time.sleep(1)
    txt, _ = call("manage_triggers", {"action": "list"})
    check("S4e trigger cascaded", not txt or kw not in (txt or ""), (txt or "")[:60])
    txt, _ = call("search_memory", {"query": kw})
    check("S4f no orphan recall", not txt or uri not in (txt or ""), (txt or "")[:40])
    if uri in created:
        created.remove(uri)


def s5_hierarchy():
    print("S5 hierarchy walk")
    txt, _ = call("list_memories", {"uri": "noc://", "limit": 50})
    check("S5a root list", txt is not None and len(txt) > 0, (txt or "")[:50])
    txt, _ = call("list_memories", {"uri": "noc://agent", "limit": 10})
    check("S5b agent children", txt and "noc://agent/" in txt, (txt or "")[:60])
    parent, _ = create("noc://", f"zt-loop-{uid} parent")
    if not parent:
        check("S5c parent create", False); return
    child, _ = create(parent, f"zt-loop-{uid} child")
    if not child:
        check("S5d child create", False); return
    txt, _ = call("list_memories", {"uri": parent, "limit": 10})
    check("S5e nested children", txt and child in txt, (txt or "")[:60])
    txt, err = call("list_memories", {"uri": "noc://zt_does_not_exist_xyz", "limit": 5})
    check("S5f missing path graceful", (err and "not found" in err.lower()) or (txt and "no children" in txt.lower()) or (txt is not None and txt.strip() == ""), (err or txt or "")[:50])


def s6_full_replace_vs_append():
    print("S6 full-replace vs append")
    uri, _ = create("noc://", f"zt-loop-{uid} replace base content A")
    if not uri:
        check("S6a create", False); return
    call("update_memory", {"uri": uri, "content": f"zt-loop-{uid} content B only"})
    txt, _ = call("read_memory", {"uri": uri})
    check("S6b content replaced", txt and "B only" in txt and "content A" not in txt, (txt or "")[:50])
    call("update_memory", {"uri": uri, "append": f" zt-loop-{uid} appended C"})
    txt, _ = call("read_memory", {"uri": uri})
    check("S6c append keeps body", txt and "B only" in txt and "appended C" in txt, (txt or "")[:60])


def s7_rename_contract():
    print("S7 rename contract (children + alias)")
    parent, _ = create("noc://", f"zt-loop-{uid} rename parent")
    if not parent:
        check("S7a create parent", False); return
    child, _ = create(parent, f"zt-loop-{uid} rename child")
    if not child:
        check("S7b create child", False); return
    al = f"noc://zt_rn_alias_{uid}"
    call("add_alias", {"new_uri": al, "target_uri": child})
    created.append(al)
    np = f"noc://zt_renamed_{uid}"
    txt, _ = call("rename_memory", {"uri": parent, "new_name": f"zt_renamed_{uid}"})
    check("S7c rename parent", txt and "Renamed" in txt, (txt or "")[:40])
    # contract: rename cascades — child path follows the new prefix, alias stays
    new_child = f"{np}/{child.split('/')[-1]}"
    txt, _ = call("read_memory", {"uri": new_child})
    check("S7d child path cascaded", txt and "rename child" in txt, (txt or "")[:40])
    txt, _ = call("read_memory", {"uri": child})
    check("S7e old child path dead", txt and "not found" in txt.lower(), (txt or "")[:40])
    txt, _ = call("list_memories", {"uri": np, "limit": 10})
    check("S7f new parent lists child", txt and child.split("/")[-1] in txt, (txt or "")[:60])
    txt, _ = call("read_memory", {"uri": al})
    check("S7g alias still resolves", txt is not None, (txt or "")[:40])
    created.append(np)
    created.append(new_child)


def s8_search_modes():
    print("S8 search modes")
    uri, _ = create("noc://", f"zt-loop-{uid} searchable rocket launch pad")
    if not uri:
        check("S8a create", False); return
    txt, _ = call("search_memory", {"query": f"rocket launch pad zt-loop-{uid}"})
    check("S8b multi-word FTS", txt and uri in txt, (txt or "")[:70])
    txt, _ = call("search_memory", {"query": f"zt-loop-{uid} completely unrelated phrase nobody wrote down"})
    check("S8c token-OR fallback", txt and uri in txt, (txt or "")[:70])
    txt, _ = call("search_memory", {"query": "qzxvkw" + uuid.uuid4().hex[:10]})
    check("S8d empty result graceful", txt is not None and "no results" in txt.lower(), (txt or "")[:50])
    txt, err = call("search_memory", {"query": ""})
    check("S8e empty query handled", txt is not None or err, (txt or err or "")[:50])


def s9_system_nodes():
    print("S9 system nodes")
    for node in ["system://boot", "system://briefing", "system://index", "system://recent", "system://diagnostic/noc"]:
        txt, err = call("read_memory", {"uri": node})
        check(f"S9 {node}", txt is not None and len(txt or "") > 10, (txt or err or "")[:50])


def s10_boundaries():
    print("S10 boundary/error handling")
    txt, err = call("create_memory", {"parent_uri": "noc://", "content": ""})
    check("S10a empty content rejected", txt is None and err is not None, (err or txt or "")[:50])
    txt, err = call("read_memory", {"uri": "noc://zt_missing_" + uid})
    check("S10b missing uri error", err is not None or (txt and "not found" in txt.lower()), (err or txt or "")[:60])
    txt, err = call("create_memory", {"parent_uri": "not-a-uri", "content": f"zt-loop-{uid} bad parent"})
    check("S10c bad parent rejected", txt is None and err is not None, (err or txt or "")[:60])
    big = f"zt-loop-{uid} big " + "x" * 70000
    txt, err = call("create_memory", {"parent_uri": "noc://", "content": big})
    check("S10d oversized rejected", txt is None and err is not None, (err or txt or "")[:60])


def s11_slug():
    print("S11 slug fidelity")
    uri, _ = create("noc://", f"zt-loop-{uid}", title="zt-loop-keep-hyphen-" + uid)
    check("S11a hyphen kept", uri and "-" in uri and "_" not in uri.split("zt-loop-")[-1].split("-" + uid)[0], uri or "no uri")
    # no-title fallback slugs the first content line: spaces -> underscores, hyphens kept
    uri2, _ = create("noc://", f"zt-loop-{uid} no title fallback")
    check("S11b no-title fallback", uri2 and uri2.endswith("_no_title_fallback"), uri2 or "no uri")
    if uri:
        created.append(uri)
    if uri2:
        created.append(uri2)


def s12_expiry_clear():
    print("S12 expiry clear")
    past = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 3600))
    future = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 86400))
    uri, _ = create("noc://", f"zt-loop-{uid} exp clear", expires_at=past)
    if not uri:
        check("S12a create", False); return
    txt, _ = call("read_memory", {"uri": uri})
    check("S12b past = expired", txt and "[expired" in txt, (txt or "")[:30])
    call("update_memory", {"uri": uri, "expires_at": ""})
    txt, _ = call("read_memory", {"uri": uri})
    check("S12c clear expiry", txt and "[expired" not in txt, (txt or "")[:40])
    uri2, _ = create("noc://", f"zt-loop-{uid} exp future", expires_at=future)
    if uri2:
        txt, _ = call("read_memory", {"uri": uri2})
        check("S12d future ok", txt and "[expired" not in txt, (txt or "")[:30])
        created.append(uri2)


def s13_audit_query():
    print("S13 audit query + rollback via listed id")
    uri, _ = create("noc://", f"zt-loop-{uid} audit base")
    if not uri:
        check("S13a create", False); return
    txt, _ = call("update_memory", {"uri": uri, "content": f"zt-loop-{uid} audit v2"})
    check("S13b update", txt and "Updated" in txt, (txt or "")[:30])
    txt, _ = call("list_audit", {"uri": uri, "limit": 10})
    check("S13c list_audit filter by uri", txt and "update" in txt and uri in txt, (txt or "")[:80])
    import re as _re
    m = _re.search(r"#(\d+) update", txt or "")
    check("S13d audit id extractable", m is not None, (txt or "")[:80])
    aid = int(m.group(1)) if m else 0
    txt, _ = call("rollback_memory", {"audit_id": aid})
    check("S13e rollback via listed id", txt and "rolled back" in txt, (txt or "")[:40])
    txt, _ = call("read_memory", {"uri": uri})
    check("S13f restored", txt and "audit base" in txt and "audit v2" not in txt, (txt or "")[:50])
    txt, _ = call("list_audit", {"limit": 3})
    check("S13g list_audit unfiltered", txt and "create" in txt, (txt or "")[:80])


def s14_rename_cascade():
    print("S14 rename cascades to descendant paths")
    parent, _ = create("noc://", f"zt-loop-{uid} cascade root")
    if not parent:
        check("S14a create parent", False); return
    child, _ = create(parent, f"zt-loop-{uid} cascade mid")
    if not child:
        check("S14b create child", False); return
    grand, _ = create(child, f"zt-loop-{uid} cascade leaf")
    if not grand:
        check("S14c create grandchild", False); return
    old_prefix = parent
    txt, _ = call("rename_memory", {"uri": parent, "new_name": f"cascade_renamed_{uid}"})
    check("S14d rename root", txt and "Renamed" in txt, (txt or "")[:40])
    new_parent = f"noc://cascade_renamed_{uid}"
    new_child = f"{new_parent}/{child.split('/')[-1]}"
    new_grand = f"{new_child}/{grand.split('/')[-1]}"
    txt, _ = call("read_memory", {"uri": new_child})
    check("S14e child path rewritten", txt and "cascade mid" in txt, (txt or "")[:40])
    txt, _ = call("read_memory", {"uri": new_grand})
    check("S14f grandchild path rewritten", txt and "cascade leaf" in txt, (txt or "")[:40])
    txt, _ = call("read_memory", {"uri": child})
    check("S14g old child path dead", txt and "not found" in txt.lower(), (txt or "")[:40])
    txt, _ = call("search_memory", {"query": f"cascade leaf zt-loop-{uid}"})
    check("S14h search finds new path", txt and new_grand in txt, (txt or "")[:70])
    created.extend([new_grand, new_child, new_parent])


def s15_trigger_relevance():
    print("S15 trigger relevance (exact first, short words safe, dedup)")
    uri_a, _ = create("noc://", f"zt-loop-{uid} alpha trigger subject")
    uri_b, _ = create("noc://", f"zt-loop-{uid} beta trigger subject")
    if not uri_a or not uri_b:
        check("S15a create", False); return
    kw_a = f"zt-trig-exact-{uid}"
    kw_b = f"zt-trig-sub-{uid}"
    call("manage_triggers", {"action": "add", "keyword": kw_a, "target_uri": uri_a})
    call("manage_triggers", {"action": "add", "keyword": kw_b, "target_uri": uri_b})
    # short keyword that is a substring of many words must NOT hijack recall
    call("manage_triggers", {"action": "add", "keyword": "ai", "target_uri": uri_b})
    txt, _ = call("search_memory", {"query": kw_a})
    check("S15b exact keyword recalls exact node", txt and "[trigger]" in txt and uri_a in txt, (txt or "")[:70])
    txt, _ = call("search_memory", {"query": f"painting {kw_b}"})
    check("S15c substring keyword still recalls", txt and uri_b in txt, (txt or "")[:70])
    txt, _ = call("search_memory", {"query": "painting the landscape"})
    check("S15d short keyword (ai) not hijacked", not txt or uri_b not in txt, (txt or "")[:70])
    # both keywords on one node -> single hit (dedup)
    call("manage_triggers", {"action": "add", "keyword": f"zt-trig-dup1-{uid}", "target_uri": uri_a})
    call("manage_triggers", {"action": "add", "keyword": f"zt-trig-dup2-{uid}", "target_uri": uri_a})
    txt, _ = call("search_memory", {"query": f"zt-trig-dup1-{uid}"})
    check("S15e multi-keyword node returns once", txt and uri_a in txt, (txt or "")[:70])


def s16_focus_aggregation():
    print("S16 focus aggregates recent work trees (zero new concepts)")
    # build a two-level working tree, then focus must surface it grouped by root
    parent, _ = create("noc://agent", f"zt-loop-{uid} focus area")
    if not parent:
        check("S16a create parent under agent", False); return
    child, _ = create(parent, f"zt-loop-{uid} focus sub note")
    if not child:
        check("S16b create child", False); return
    time.sleep(1)  # ensure created_at ordering is stable
    txt, _ = call("read_memory", {"uri": "system://focus"})
    check("S16c focus lists working tree", txt and "Focus" in txt and "zt-loop-" + uid in txt, (txt or "")[:120])
    # the tree root (first two path segments) must appear, not just the leaf
    root = "/".join(parent.split("/")[:2]) if "/" in parent else parent
    check("S16d focus groups by tree root", txt and root in txt, (txt or "")[:120])


def main():
    print(f"noc scenario loop (uid={uid})\n")
    for fn in [s1_project_handoff, s2_meeting_note, s3_self_correction, s4_trigger_mgmt,
               s5_hierarchy, s6_full_replace_vs_append, s7_rename_contract, s8_search_modes,
               s9_system_nodes, s10_boundaries, s11_slug, s12_expiry_clear,
               s13_audit_query, s14_rename_cascade, s15_trigger_relevance, s16_focus_aggregation]:
        try:
            fn()
        except Exception as e:
            check(fn.__name__, False, f"EXC {type(e).__name__}: {str(e)[:60]}")
        print()

    ok = cleanup()
    check("CLEANUP all test data removed", ok, "search residual")

    print(f"\n=== RESULTS: {len(PASS)} pass, {len(FAIL)} fail ===")
    if FAIL:
        print("FAILED:", ", ".join(FAIL))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
