import { checkAuth } from "./auth";
import { Env } from "./config";
import { dbStatus, getAudit, listAll, listAudit, rollbackMemory, searchMemory, syncSearchFromPaths, systemBoot, systemRecent } from "./db";
import { handleMcpRequest } from "./mcp";
import { UI_HTML } from "./ui";

async function takeSnapshot(env: Env): Promise<string> {
  const dump = await env.DB.prepare(
    `SELECT 'nodes' AS t, json_group_array(json_object('uuid', uuid, 'created_at', created_at, 'last_accessed_at', last_accessed_at)) AS j FROM nodes
     UNION ALL SELECT 'memories', json_group_array(json_object('id', id, 'node_uuid', node_uuid, 'content', content, 'deprecated', deprecated, 'migrated_to', migrated_to, 'created_at', created_at)) FROM memories
     UNION ALL SELECT 'edges', json_group_array(json_object('id', id, 'parent_uuid', parent_uuid, 'child_uuid', child_uuid, 'name', name, 'priority', priority, 'disclosure', disclosure, 'created_at', created_at)) FROM edges
     UNION ALL SELECT 'paths', json_group_array(json_object('domain', domain, 'path', path, 'edge_id', edge_id, 'node_uuid', node_uuid, 'created_at', created_at)) FROM paths
     UNION ALL SELECT 'triggers', json_group_array(json_object('id', id, 'keyword', keyword, 'node_uuid', node_uuid, 'created_at', created_at)) FROM triggers`
  )
    .all<{ t: string; j: string }>();

  const tables: Record<string, unknown> = {};
  for (const row of dump.results ?? []) {
    tables[row.t] = JSON.parse(row.j);
  }
  const snap = { taken_at: new Date().toISOString(), tables };
  const key = `snapshots/${new Date().toISOString().slice(0, 10)}.json`;
  await env.SNAPSHOTS.put(key, JSON.stringify(snap));
  return key;
}

async function jsonOk(body: unknown): Promise<Response> {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await takeSnapshot(env);
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Web panel lives under /admin so one Access app ("/admin") protects
    // both the UI and admin API, leaving /mcp outside any Access app.
    if ((url.pathname === "/admin" || url.pathname === "/admin/") && req.method === "GET") {
      // Server-render the mode banner + (if Access) pre-load boot data,
      // so the page is useful even if client JS errors out.
      const accessOk = !!req.headers.get("Cf-Access-Authenticated-User-Email");
      const bootText = accessOk ? await systemBoot(env.DB) : null;
      const html = UI_HTML
        .replaceAll("__AUTH_MODE__", accessOk ? "access" : "bearer")
        .replace("__STATUS_TEXT__", accessOk ? "access verified" : "bearer required")
        .replace("__STATUS_CLASS__", accessOk ? " ok" : "")
        .replace(
          "__AUTH_ZONE_HTML__",
          accessOk
            ? '<div class="auth-banner"><span class="ok">&#9679;</span> authenticated via Cloudflare Access</div>'
            : '<div class="token-form">' +
              '<div class="field"><label for="tok">API token</label><input id="tok" type="password" placeholder="enter token" autocomplete="off" value="' + (env.API_TOKEN ? "" : "") + '"></div>' +
              '<button class="btn" id="tokGo">Unlock</button>' +
              '<div class="hint">no token? wrangler secret put API_TOKEN. or protect this page with Cloudflare Access.</div>' +
              '</div>'
        )
        .replace("__BOOT_DATA__", bootText === null ? "null" : JSON.stringify(bootText));
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    // Admin data endpoints: dual-mode (Access header OR Bearer), see auth.ts.
    const denied = checkAuth(req, env);
    if (denied) return denied;

    if (url.pathname === "/admin/boot" && req.method === "GET") {
      const text = await systemBoot(env.DB);
      return jsonOk({ text });
    }
    if (url.pathname === "/admin/search" && req.method === "GET") {
      const q = url.searchParams.get("q") || "";
      const hits = await searchMemory(env.DB, q, 20);
      return jsonOk({ hits });
    }
    if (url.pathname === "/admin/all" && req.method === "GET") {
      return jsonOk({ entries: await listAll(env.DB) });
    }
    if (url.pathname === "/admin/recent" && req.method === "GET") {
      const items = await systemRecent(env.DB, 20);
      return jsonOk({ items });
    }
    if (url.pathname === "/admin/audit" && req.method === "GET") {
      return jsonOk({ entries: await listAudit(env.DB, 40) });
    }
    const auditDetail = /^\/admin\/audit\/(\d+)$/.exec(url.pathname);
    if (auditDetail && req.method === "GET") {
      const a = await getAudit(env.DB, Number(auditDetail[1]));
      if (!a) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
      return jsonOk({ audit: a });
    }
    if (auditDetail && req.method === "POST" && url.pathname.endsWith("/rollback")) {
      return jsonOk(await rollbackMemory(env.DB, Number(auditDetail[1])));
    }
    if (/^\/admin\/audit\/\d+\/rollback$/.test(url.pathname) && req.method === "POST") {
      const id = Number(url.pathname.split("/")[3]);
      return jsonOk(await rollbackMemory(env.DB, id));
    }
    if (url.pathname === "/admin/status" && req.method === "GET") {
      return jsonOk(await dbStatus(env.DB, env.SNAPSHOTS));
    }

    if (url.pathname === "/health" && req.method === "GET") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/admin/rebuild-search" && req.method === "POST") {
      await syncSearchFromPaths(env.DB);
      return new Response(JSON.stringify({ status: "ok", rebuilt: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/admin/snapshot" && req.method === "POST") {
      const key = await takeSnapshot(env);
      return new Response(JSON.stringify({ status: "ok", key }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/mcp" && req.method === "POST") {
      const ct = req.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        return new Response(JSON.stringify({ error: "content-type must be application/json" }), {
          status: 415,
          headers: { "content-type": "application/json" },
        });
      }
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: "invalid JSON body" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return handleMcpRequest(body, env);
    }

    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  },
};
