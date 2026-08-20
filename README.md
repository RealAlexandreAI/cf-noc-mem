# Noc Memory (cf-noc-mem)

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="Noc Memory — serverless long-term memory for AI agents on Cloudflare Workers">
</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/RealAlexandreAI/cf-noc-mem"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare Workers"></a>
</p>

<p align="center"><strong><a href="README.zh.md">中文文档</a></strong> · English</p>

A stateless, single-user **long-term memory server** for AI agents, running entirely on Cloudflare's free tier. No VPS, no database server, no vector store — just a Worker + D1 + R2.

> Based on the upstream [nocturne_memory](https://github.com/Dataojitori/nocturne_memory) memory-graph concept, rewritten serverless and stripped to what one person actually needs. Also available as agent plugins: [dsh-noc-memory](https://github.com/RealAlexandreAI/dsh-noc-memory) · [pi-noc-memory](https://github.com/RealAlexandreAI/pi-noc-memory).

## Why

Most "agent memory" setups bolt a vector DB onto a chat client. Noc Memory treats memory as a **hierarchical tree** (`noc://agent`, `noc://agent/deploy_pipeline`, …) with versioned content, trigger keywords, and audit rollback — so an agent can explore, update, and even correct its own past knowledge.

- **Zero infra**: Worker + D1 + R2, all inside Cloudflare's free tier
- **Stateless MCP** (Streamable HTTP): no SSE, no sessions — agents just `POST /mcp`
- **Tree memory**: `noc://` URIs, browse via `list_memories`
- **Trigger recall**: keywords bound to memories rank above full-text search
- **Semantic search** *(optional)*: multilingual embeddings (bge-m3) + Vectorize merge semantic recall with keyword search — see [§9](#9-optional-semantic-search-vectorize)
- **Foresight**: memories can carry an expiry — they auto-leave search when stale
- **Daily briefing**: `system://briefing` — what changed, what's expiring, what's cold
- **Focus**: `system://focus` — recently-updated memories grouped into working trees, so long-running work resumes without browsing
- **Audit + rollback**: every change is tracked; mistakes are undoable
- **Auto-forget** ("dream"): cron drops old versions, expired content, and cold low-priority memories — no manual cleanup

## MCP tools (12)

| tool | purpose |
|------|---------|
| `read_memory(uri)` | read by URI; also `system://boot`, `system://briefing`, `system://focus`, `system://index/<domain>`, `system://recent[/N]` |
| `list_memories(uri, limit?)` | browse child memories under a URI |
| `create_memory(parent_uri, content, priority, disclosure, expires_at?)` | create under an existing parent |
| `update_memory(uri, append?/old_string+new_string?, priority?, disclosure?, expires_at?, relation?)` | new versioned row; `relation` marks evolution: `replace|enrich|confirm|challenge` |
| `delete_memory(uri)` | cut a URI path; returns orphaned children if any |
| `add_alias(new_uri, target_uri, …)` | another path to the same memory |
| `search_memory(query, limit?)` | trigger-keyword recall first, then FTS5 trigram (CJK-friendly), LIKE fallback; merges semantic hits when Vectorize is configured (optional) |
| `rollback_memory(audit_id)` | undo a change from the audit log |
| `manage_triggers(action, keyword, target_uri?)` | add / remove / list trigger keywords |
| `rename_memory(uri, new_name)` | rename the last path segment (node & content stay, search re-indexed, descendant paths follow) |
| `list_audit(uri?, limit?)` | browse recent audit entries to pick an `audit_id` for rollback |
| `reindex_vectors()` | *(optional)* backfill semantic vectors for all existing memories; no-op without Vectorize — only needed after enabling §9 on an already-populated store |

Also: `create_memory` accepts an explicit `title` (path name) so the content's first line is not eaten; REST API is reachable at `/api/*` with Bearer auth.

## Deploy to your own Cloudflare

### 1. Prerequisites

- [Cloudflare account](https://dash.cloudflare.com) — the **free plan works**: this project is designed to fit the free tier (Workers 100k req/day, D1 5 GB, R2 10 GB). No paid upgrade needed for personal use.
- [wrangler](https://developers.cloudflare.com/workers/wrangler/) CLI, logged in
- A domain you can add a DNS record to (or use the default `*.workers.dev`)

### 2. Clone & install

```bash
git clone https://github.com/RealAlexandreAI/cf-noc-mem.git
cd cf-noc-mem
npm install
npx wrangler login   # if not already logged in
```

### 3. Configure

```bash
# your secret MCP bearer token (agents authenticate with it)
echo -n "$(openssl rand -hex 24)" | npx wrangler secret put API_TOKEN

# local dev token (only for npx wrangler dev)
echo "API_TOKEN=dev-token" > .dev.vars
```

### 4. Provision D1 + R2

```bash
# create database + bucket
npx wrangler d1 create noc_mem
npx wrangler r2 bucket create noc-mem-snapshots
```

Then copy `wrangler.jsonc` to `wrangler.local.jsonc` (gitignored) and fill in the ids printed by the commands above — keeping your real ids out of git:

```bash
cp wrangler.jsonc wrangler.local.jsonc
# edit wrangler.local.jsonc: database_id + your domain (or remove the routes block for *.workers.dev)
```

```jsonc
"d1_databases": [{ "database_name": "noc_mem", "database_id": "<paste here>" }],
"r2_buckets":   [{ "bucket_name": "noc-mem-snapshots" }]
```

```bash
# apply the schema
npx wrangler d1 migrations apply noc_mem --remote
```

### 5. Deploy

```bash
npm run build --prefix frontend   # build the admin panel
npx wrangler deploy --config wrangler.local.jsonc   # real ids from your local config
```

### 6. Point your domain (optional)

Workers automatically get `https://<worker-name>.<your-subdomain>.workers.dev`. For a custom domain like `mem.example.com`, add a CNAME record pointing to your worker's `*.workers.dev` host, then in the dashboard: Worker → Settings → Domains & Routes → Add → Custom Domain.

### 7. Verify

```bash
# MCP handshake (Bearer auth)
curl -X POST https://mem.example.com/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

# admin panel lives at /admin/ (any non-/admin path redirects there)
open https://mem.example.com/admin/
```

### 8. Protect the admin panel (recommended)

The whole panel lives under `/admin`; `/mcp` and static assets stay public (MCP is Bearer-gated, assets are a UI shell with no data). Put the panel behind **Cloudflare Access**:

- Zero Trust → Access → Applications → Add → self-hosted
- Domain: `mem.example.com/admin` → policy: allow your email(s)
- `/mcp` stays outside Access — agents reach it with Bearer only

### 9. (Optional) Semantic search with Vectorize

**Keyword search is the default and works with zero extra setup** (triggers → FTS5 trigram → LIKE). Semantic search is an **optional add-on** for the case where a memory is conceptually relevant but shares no keywords with the query — e.g. searching `部署失败` should also recall a note written as *"发布流水线挂了，回滚后恢复"*.

- **Cost**: Vectorize and Workers AI embeddings are free-tier eligible; personal usage stays well inside the quota. Skip this section entirely if you don't need semantic recall.
- **How it works**: on every memory write/update/rename/delete, `@cf/baai/bge-m3` (multilingual, CJK-capable) embeds title+content into a 1024-d vector in the `noc-mem-vec` index; `search_memory` then merges semantic hits with keyword hits (deduped, semantic first).
- **Graceful degradation**: Vectorize/AI are optional bindings — if unbound or failing, search silently falls back to keyword-only and memory writes never break.

Enable it:

```bash
# 1. create the index (once)
npx wrangler vectorize create noc-mem-vec --dimensions 1024 --metric cosine

# 2. add bindings to wrangler.local.jsonc (and wrangler.jsonc if you deploy from it)
# "ai": { "binding": "AI" },
# "vectorize": [{ "binding": "VECTORIZE", "index_name": "noc-mem-vec" }]

# 3. redeploy, then backfill vectors for memories written before enabling:
#    call MCP tool reindex_vectors() — or just wait; new writes index themselves
```

After enabling, `search_memory` returns semantic + keyword results; `reindex_vectors` reports `ok/total` and any failures land in Workers Logs as `vector_upsert_failed`.

## Frontend

A React admin panel (Vite) at `frontend/`, served by the Worker's assets binding. Two pages:

- `/admin/review` — **记忆准入 / Memory Intake**: pending changes from the audit log; approve or rollback
- `/admin/memory` — **记忆浏览 / Memory Browse**: the memory tree (`noc://`), search, create/edit/delete, trigger keywords, boot list

## Agent plugins

Deploy once, then plug any agent into your instance:

- **[dsh-noc-memory](https://www.npmjs.com/package/dsh-noc-memory)** — dsh plugin: session-start boot + daily briefing + memory tools (`dsh plugin --profile web add dsh-noc-memory`)
- **[pi-noc-memory](https://www.npmjs.com/package/pi-noc-memory)** — pi extension: `SessionStart` boot protocol + memory rules (`pi install npm:pi-noc-memory`)

Both talk to your `/mcp` endpoint with a Bearer token.

## Manual MCP config (no plugin)

No plugin needed — any MCP client that supports **Streamable HTTP** can talk to your server directly. The endpoint is `https://<your-host>/mcp`, authenticated with the `Authorization: Bearer <API_TOKEN>` header (the same token you set in step 3).

Generic `mcpServers` entry (Claude Code, Cursor, VS Code, etc.):

```json
{
  "mcpServers": {
    "noc-memory": {
      "type": "http",
      "url": "https://mem.example.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_TOKEN"
      }
    }
  }
}
```

Claude Desktop (`claude_desktop_config.json`) uses the same shape:

```json
{
  "mcpServers": {
    "noc-memory": {
      "type": "http",
      "url": "https://mem.example.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_TOKEN"
      }
    }
  }
}
```

Once connected, the agent sees the 11 tools (`read_memory`, `list_memories`, `create_memory`, …) directly. The plugins above only add convenience — a session-start boot protocol and memory-writing rules — none of which is required for the memory server to work.

### Agent rules when running without a plugin

The plugins do two things beyond the tools: a **session-start boot** and **memory-writing rules**. With a manual config you get neither — drop these rules into your agent (CLAUDE.md, `.cursor/rules`, or any system prompt) so the memory actually gets used:

```markdown
## Noc Memory usage rules

### Session start
- Call `read_memory` on `system://boot` first — it anchors the session with core memories.
- Then `system://briefing` for today's context (recent activity, expiring memories, cold candidates).
- Then `system://focus` to see which working trees were touched recently — resume the active one. (`system://recent` is a subset of the briefing; no need to read it separately.)

### Read
- Prefer `search_memory` over browsing — it surfaces trigger-keyword-bound memories above FTS noise.
- Periodically read `system://diagnostic/noc` to catch stale, orphaned or crowded memories.

### Write
- Pull-based: write only what you would look up again. Skip ephemera (task logs, one-off facts).
- Search before writing: same topic → `update_memory`; new topic → `create_memory`.
- Prefer full rewrite with `content=` over `append` when a memory evolves.
- New info contradicts old memory → `update_memory` with `relation: "challenge"`.
- Parent URI: `noc://agent` for general knowledge; a project node for scoped knowledge.
- `priority`: 0 = most important (recalled first); higher = less important.
- `expires_at`: set for temporary knowledge (meeting notes…) so it auto-deprecates.
- `disclosure`: mark anything sensitive.
- Keep titles short and ASCII — they become the URI path.
- Bind `manage_triggers` keywords to deep memories so a later search recalls them directly.

### Maintenance
- Keep nodes flat: shared facts on the parent, specifics on children.
- If a memory is never read again, ask why before keeping it.
```

That is exactly what the [pi plugin's rules](https://github.com/RealAlexandreAI/pi-noc-memory) inject at session start — the manual config just makes you own the copy.

## Tests

Frontend unit tests (vitest):

```bash
cd frontend
npm test          # watch mode
npm run test:run  # single pass (CI-friendly)
```

Worker scripts (`package.json`): `npm run dev` (wrangler dev), `npm run deploy`, `npm run db:migrate:remote`.

## License

MIT — fork it, deploy it, make it yours.

## Related

- [dsh-noc-memory](https://github.com/RealAlexandreAI/dsh-noc-memory) — dsh plugin, same memory tools
- [pi-noc-memory](https://github.com/RealAlexandreAI/pi-noc-memory) — pi extension (session-start boot + briefing)
- [nocturne_memory](https://github.com/Dataojitori/nocturne_memory) — the upstream project this is derived from
