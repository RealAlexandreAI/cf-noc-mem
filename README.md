# Noc Memory (cf-noc-mem)

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="Noc Memory — serverless long-term memory for AI agents on Cloudflare Workers">
</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/RealAlexandreAI/cf-noc-mem"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare Workers"></a>
</p>

A stateless, single-user **long-term memory server** for AI agents, running entirely on Cloudflare's free tier. No VPS, no database server, no vector store — just a Worker + D1 + R2.

> Based on the upstream [nocturne_memory](https://github.com/Dataojitori/nocturne_memory) memory-graph concept, rewritten serverless and stripped to what one person actually needs. Also available as agent plugins: [dsh-noc-memory](https://github.com/RealAlexandreAI/dsh-noc-memory) · [pi-noc-memory](https://github.com/RealAlexandreAI/pi-noc-memory).

## Why

Most "agent memory" setups bolt a vector DB onto a chat client. Noc Memory treats memory as a **hierarchical tree** (`noc://agent`, `noc://agent/deploy_pipeline`, …) with versioned content, trigger keywords, and audit rollback — so an agent can explore, update, and even correct its own past knowledge.

- **Zero infra**: Worker + D1 + R2, all inside Cloudflare's free tier
- **Stateless MCP** (Streamable HTTP): no SSE, no sessions — agents just `POST /mcp`
- **Tree memory**: `noc://` URIs, browse via `list_memories`
- **Trigger recall**: keywords bound to memories rank above full-text search
- **Foresight**: memories can carry an expiry — they auto-leave search when stale
- **Daily briefing**: `system://briefing` — what changed, what's expiring, what's cold
- **Audit + rollback**: every change is tracked; mistakes are undoable
- **Auto-forget** ("dream"): cron drops old versions, expired content, and cold low-priority memories — no manual cleanup

## MCP tools (9)

| tool | purpose |
|------|---------|
| `read_memory(uri)` | read by URI; also `system://boot`, `system://briefing`, `system://index/<domain>`, `system://recent[/N]` |
| `list_memories(uri, limit?)` | browse child memories under a URI |
| `create_memory(parent_uri, content, priority, disclosure, expires_at?)` | create under an existing parent |
| `update_memory(uri, append?/old_string+new_string?, priority?, disclosure?, expires_at?, relation?)` | new versioned row; `relation` marks evolution: `replace|enrich|confirm|challenge` |
| `delete_memory(uri)` | cut a URI path; returns orphaned children if any |
| `add_alias(new_uri, target_uri, …)` | another path to the same memory |
| `search_memory(query, limit?)` | trigger-keyword recall first, then FTS5 trigram (CJK-friendly), LIKE fallback |
| `rollback_memory(audit_id)` | undo a change from the audit log |
| `manage_triggers(action, keyword, target_uri?)` | add / remove / list trigger keywords |

## Deploy to your own Cloudflare

### 1. Prerequisites

- [Cloudflare account](https://dash.cloudflare.com) with **Workers Paid** (D1 + R2 are not on the forever-free plan)
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

Then edit `wrangler.jsonc` and fill in the ids printed by the commands above:

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
npx wrangler deploy
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

## Frontend

A React admin panel (Vite) at `frontend/`, served by the Worker's assets binding. Two pages:

- `/admin/review` — **记忆准入 / Memory Intake**: pending changes from the audit log; approve or rollback
- `/admin/memory` — **记忆浏览 / Memory Browse**: the memory tree (`noc://`), search, create/edit/delete, trigger keywords, boot list

## Agent plugins

Deploy once, then plug any agent into your instance:

- **[dsh-noc-memory](https://www.npmjs.com/package/dsh-noc-memory)** — dsh plugin: session-start boot + daily briefing + memory tools (`dsh plugin --profile web add dsh-noc-memory`)
- **[pi-noc-memory](https://www.npmjs.com/package/pi-noc-memory)** — pi extension: `SessionStart` boot protocol + memory rules (`pi install npm:pi-noc-memory`)

Both talk to your `/mcp` endpoint with a Bearer token.

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
