#!/usr/bin/env python3
"""Evaluate Noc Memory retrieval on LoCoMo QA pairs (session-aggregated mode).

For each question: search_memory(q) -> top-k hits. A hit counts as recall if
any evidence turn text (normalized, distinctive probe) appears inside the
retrieved session-aggregated memory content. Reports recall@k per category.

This measures the RETRIEVER with memories stored the way noc is meant to be
used (one distilled memory per session, not per turn).
"""
import json
import re
import sys
import time
import urllib.request
from collections import defaultdict

MCP_URL = "http://127.0.0.1:8788/mcp"
TOKEN = "602b6394e06d056626a9f962f16d7776fb291f1bfdb27a3a"
DATA = "/tmp/locomo/data/locomo10.json"
K = 5
CAT_NAMES = {1: "multi-hop", 2: "temporal", 3: "open-domain", 4: "single-hop", 5: "adversarial"}


def mcp(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": int(time.time() * 1000) % 100000, "method": method, "params": params}).encode()
    req = urllib.request.Request(MCP_URL, data=body, headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def search(query):
    r = mcp("tools/call", {"name": "search_memory", "arguments": {"query": query, "limit": K}})
    res = r.get("result", {})
    txt = (res.get("content") or [{}])[0].get("text", "")
    if txt == "(no results)" or txt.startswith("Unknown"):
        return []
    hits = []
    for block in txt.split("\n\n"):
        lines = block.split("\n")
        idx = 0
        if lines and lines[0].startswith("[") and lines[0].endswith("hits]"):
            idx = 1
        if idx >= len(lines) or not lines[idx].startswith("noc://"):
            continue
        uri = lines[idx].split(" [")[0].strip()
        snippet = lines[-1] if len(lines) > idx + 1 else ""
        hits.append((uri, snippet))
    return hits


def normalize(s):
    s = s.lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def evidence_texts(conv, qa):
    """dia_id -> turn text for this conversation's QA evidence."""
    texts = []
    for e in qa.get("evidence", []):
        for k, v in conv["conversation"].items():
            if not k.startswith("session_") or k.endswith("date_time"):
                continue
            for t in v:
                if t.get("dia_id") == e:
                    texts.append(t.get("text", ""))
    return [t for t in texts if t.strip()]


def main():
    max_convs = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    data = json.load(open(DATA))

    stats = defaultdict(lambda: {"total": 0, "recall": 0})
    overall = {"total": 0, "recall": 0}
    t0 = time.time()
    checked = 0

    for conv in data[:max_convs]:
        for qa in conv["qa"]:
            cat = CAT_NAMES.get(qa["category"], "other")
            ets = evidence_texts(conv, qa)
            if not ets:
                continue
            hits = search(qa["question"])
            hit_text = " ".join(normalize(u + " " + s) for u, s in hits)

            recalled = False
            for et in ets:
                norm_et = normalize(et)
                words = norm_et.split()
                if len(words) >= 6:
                    probe = " ".join(words[: max(6, int(len(words) * 0.4))])
                else:
                    probe = norm_et
                if probe and probe in hit_text:
                    recalled = True
                    break

            stats[cat]["total"] += 1
            stats[cat]["recall"] += 1 if recalled else 0
            overall["total"] += 1
            overall["recall"] += 1 if recalled else 0
            checked += 1
            if checked % 400 == 0:
                print(f"  {checked} QA checked ({(time.time()-t0):.0f}s)", flush=True)

    print(f"\n=== LoCoMo recall@{K} (Noc Memory, session-aggregated, {checked} QA, {(time.time()-t0):.0f}s) ===")
    for cat in ["single-hop", "temporal", "multi-hop", "open-domain", "adversarial"]:
        s = stats[cat]
        if s["total"]:
            print(f"  {cat:12s}: {s['recall']/s['total']*100:5.1f}%  ({s['recall']}/{s['total']})")
    print(f"  {'OVERALL':12s}: {overall['recall']/overall['total']*100:5.1f}%  ({overall['recall']}/{overall['total']})")


if __name__ == "__main__":
    main()
