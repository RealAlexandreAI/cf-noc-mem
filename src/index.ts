import { checkAuth } from "./auth";
import { Env } from "./config";
import { syncSearchFromPaths } from "./db";
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

export default {
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await takeSnapshot(env);
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Web panel lives under /admin so one Access app ("/admin/*") protects
    // both the UI and admin API, leaving /mcp outside any Access app.
    if ((url.pathname === "/admin" || url.pathname === "/admin/") && req.method === "GET") {
      return new Response(UI_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    if (url.pathname === "/health" && req.method === "GET") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "content-type": "application/json" },
      });
    }

    const denied = checkAuth(req, env);
    if (denied) return denied;

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
