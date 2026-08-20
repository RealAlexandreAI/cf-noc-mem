# cf-noc-mem

nocturne_memory, but on Cloudflare — a stateless MCP memory server for single-user AI agents.

- **Stateless MCP (Streamable HTTP, MCP v2)**: no SSE, no long-lived sessions
- **D1 (SQLite)**: memory graph (nodes / versioned memories / edges / paths) + FTS5 trigram CJK search
- **R2**: snapshots & backups (planned)
- **Zero VPS**: everything inside Cloudflare free tier

## Why

The upstream [nocturne_memory](https://github.com/Dataojitori/nocturne_memory) is a Python/FastAPI app (~12K LOC backend) with SSE transport, Neo4j support, multi-namespace isolation and a web admin UI — all of which a single user doesn't need. This rewrite keeps the graph memory core and MCP tool surface, drops the rest, and runs it serverless.

## MCP tools (upstream-compatible names & params)

| tool | description |
|------|-------------|
| `read_memory(uri)` | read by URI; supports `system://boot`, `system://index/<domain>`, `system://recent[/N]` |
| `create_memory(parent_uri, content, priority, disclosure)` | create under an existing parent |
| `update_memory(uri, old_string?, new_string?, append?, priority?, disclosure?)` | new versioned row, old row deprecated |
| `delete_memory(uri)` | cut URI path; returns orphaned children if any |
| `add_alias(new_uri, target_uri, priority, disclosure)` | alias path to the same node |
| `search_memory(query, limit?)` | FTS5 trigram (>=3 chars) with LIKE fallback for short CJK queries |
| `manage_triggers(action, keyword, target_uri?)` | add / remove / list trigger keywords |

## Architecture

```
agent (MCP client) ──POST /mcp──▶ CF Worker (stateless JSON-RPC)
                                     ├── D1   nodes/memories/edges/paths + search_fts + audit_logs
                                     └── R2   snapshots/backups (planned)
```

## Local dev

```bash
npm install
echo "API_TOKEN=dev-token" > .dev.vars
npx wrangler d1 migrations apply noc_mem --local
npx wrangler dev
curl -X POST http://127.0.0.1:8787/mcp \
  -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

## Deploy

```bash
npx wrangler d1 create noc_mem        # fill database_id into wrangler.jsonc
npx wrangler r2 bucket create noc-mem-snapshots
npx wrangler d1 migrations apply noc_mem --remote
npx wrangler deploy                   # set API_TOKEN via wrangler secret put
```

## Status

- [x] MCP core: initialize / tools/list / tools/call, 7 tools, Bearer auth
- [x] D1 schema + FTS5 trigram CJK search (verified locally + remote D1)
- [x] PG → D1 migration (`scripts/migrate_pg_to_d1.py`, run on host with PG access; import via `wrangler d1 execute --remote --file=`)
- [x] FTS rebuild endpoint `POST /admin/rebuild-search` (run after import)
- [x] R2 snapshots: daily cron `0 3 * * *` + manual `POST /admin/snapshot`
- [x] Read-only web panel `GET /` (boot list + full-text search, token via localStorage)
- [ ] Custom domain DNS activation (`REPLACE_WITH_YOUR_DOMAIN` route created, zone DNS record pending)
- [ ] Admin panel: review / rollback

## Privacy

Public repo. No secrets in git: API token lives in `wrangler secret put API_TOKEN`; PG credentials are read from env at migration time. `.dev.vars` is gitignored.
