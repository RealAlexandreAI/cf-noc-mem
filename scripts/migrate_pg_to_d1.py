#!/usr/bin/env python3
"""Migrate nocturne_memory PG data -> D1 SQLite SQL.

Run on a host with network access to the PG (e.g. LH):
    PG_HOST=... PG_PORT=2345 PG_USER=... PG_PASSWORD=... PG_DB=nocturne_memory \
        python3 scripts/migrate_pg_to_d1.py > /tmp/noc_mem_d1.sql

Then import locally:
    cd cf-noc-mem && npx wrangler d1 execute noc_mem --remote --file=/tmp/noc_mem_d1.sql

Drops the multi-tenant namespace concept: all rows map to the default namespace.
"""
import os
import sys
import json

try:
    import psycopg2
except ImportError:
    sys.exit("psycopg2 required: pip install psycopg2-binary")

PG_HOST = os.environ["PG_HOST"]
PG_PORT = os.environ.get("PG_PORT", "5432")
PG_USER = os.environ["PG_USER"]
PG_PASSWORD = os.environ["PG_PASSWORD"]
PG_DB = os.environ.get("PG_DB", "nocturne_memory")

conn = psycopg2.connect(host=PG_HOST, port=PG_PORT, user=PG_USER, password=PG_PASSWORD, dbname=PG_DB)
conn.autocommit = True
cur = conn.cursor()

def q(v):
    """Quote a value as a SQLite literal."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v)
    return "'" + s.replace("'", "''") + "'"

def emit(table, cols, rows, on_conflict="OR IGNORE", batch=20):
    if not rows:
        return
    col_sql = ",".join(cols)
    for i in range(0, len(rows), batch):
        chunk = rows[i : i + batch]
        print(f"INSERT {on_conflict} INTO {table} ({col_sql}) VALUES")
        vals = []
        for r in chunk:
            vals.append("(" + ",".join(q(x) for x in r) + ")")
        print(",\n".join(vals) + ";")

# nodes
cur.execute("SELECT uuid, created_at, last_accessed_at FROM nodes")
emit("nodes", ["uuid", "created_at", "last_accessed_at"], cur.fetchall())

# memories (namespace-independent)
cur.execute("SELECT id, node_uuid, content, deprecated, migrated_to, created_at FROM memories")
emit("memories", ["id", "node_uuid", "content", "deprecated", "migrated_to", "created_at"], cur.fetchall())

# edges
cur.execute("SELECT id, parent_uuid, child_uuid, name, priority, disclosure, created_at FROM edges")
emit("edges", ["id", "parent_uuid", "child_uuid", "name", "priority", "disclosure", "created_at"], cur.fetchall())

# paths: drop namespace column (single-user)
cur.execute("SELECT domain, path, edge_id, node_uuid, created_at FROM paths")
emit("paths", ["domain", "path", "edge_id", "node_uuid", "created_at"], cur.fetchall())

# triggers (upstream glossary_keywords -> triggers table)
try:
    cur.execute("SELECT keyword, node_uuid FROM glossary_keywords")
    emit("triggers", ["keyword", "node_uuid"], cur.fetchall())
except Exception:
    pass  # table may not exist

# access logs
try:
    cur.execute("SELECT node_uuid, accessed_at, context FROM memory_access_logs")
    emit("memory_access_logs", ["node_uuid", "accessed_at", "context"], cur.fetchall())
except Exception:
    pass

# search_documents + search_fts are NOT migrated: rebuild them after deploy
# by calling POST /admin/rebuild-search (see src). Export for reference only.
try:
    cur.execute("SELECT domain, path, node_uuid, memory_id, uri, content, disclosure, priority, updated_at FROM search_documents")
    print(f"-- search_documents rows: {cur.rowcount} (rebuilt via /admin/rebuild-search after import)")
except Exception:
    pass

print("-- migration complete: run syncSearchFromPaths to rebuild FTS (POST /mcp admin or deploy-time hook)")
