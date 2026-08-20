#!/usr/bin/env python3
"""Ingest LoCoMo conversations session-aggregated (one memory per session).

This mirrors real noc usage: an agent stores one distilled memory per topic
rather than one per dialogue turn. Each memory = "[speaker] text" lines joined,
so search matches the session's substance, not a single turn.
"""
import json
import sys
import time
import urllib.request

MCP_URL = "http://127.0.0.1:8788/mcp"
TOKEN = "602b6394e06d056626a9f962f16d7776fb291f1bfdb27a3a"
DATA = "/tmp/locomo/data/locomo10.json"
MAX_CONVS = int(sys.argv[1]) if len(sys.argv) > 1 else 10


def mcp(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": int(time.time() * 1000) % 100000, "method": method, "params": params}).encode()
    req = urllib.request.Request(MCP_URL, data=body, headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def create(parent, content):
    r = mcp("tools/call", {"name": "create_memory", "arguments": {"parent_uri": parent, "content": content}})
    res = r.get("result", {})
    txt = (res.get("content") or [{}])[0].get("text", "")
    if "Created:" not in txt and "error" in r:
        raise RuntimeError(f"create failed: {r.get('error')} {txt[:200]}")
    return txt.split("\n")[0].replace("Created: ", "")


def main():
    data = json.load(open(DATA))
    data = data[:MAX_CONVS]
    total = 0
    t0 = time.time()
    for i, conv in enumerate(data):
        cid = conv["sample_id"]
        root = f"noc://locomo_{cid}"
        try:
            create("noc://", f"LoCoMo conversation {cid}")
        except Exception:
            pass
        conv_keys = [k for k in conv["conversation"].keys() if k.startswith("session_") and not k.endswith("date_time")]
        for sk in conv_keys:
            sess = conv["conversation"][sk]
            lines = []
            for turn in sess:
                speaker = turn.get("speaker", "")
                text = turn.get("text", "").strip()
                if not text:
                    continue
                lines.append(f"[{speaker}] {text}" if speaker else text)
            if not lines:
                continue
            content = "\n".join(lines)
            # first line as title-ish slug is automatic; content is the full session
            try:
                create(root, content)
                total += 1
            except Exception as e:
                print(f"  fail {cid}/{sk}: {e}")
        print(f"conv {cid}: {len(conv_keys)} sessions aggregated ({(time.time()-t0):.0f}s)", flush=True)
    print(f"\ningested {total} session-memories across {len(data)} conversations in {(time.time()-t0):.0f}s")


if __name__ == "__main__":
    main()
