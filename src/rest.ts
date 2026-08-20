import { Env, maxContentBytes } from "./config";
import {
  createMemory as dbCreate,
  deleteMemory,
  getNode,
  listAll,
  listAudit,
  getAudit,
  rollbackMemory,
  searchMemory,
  updateMemory,
  addAlias as dbAlias,
  renameNode,
  dbStatus,
  manageTriggers,
} from "./db";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function bad(msg: string, status = 400): Response {
  return json({ detail: msg }, status);
}

export async function handleRest(req: Request, url: URL, env: Env): Promise<Response | null> {
  let p = url.pathname; // e.g. /api/browse/node or /admin/api/browse/node
  if (p.startsWith("/admin/api/")) p = p.replace(/^\/admin\/api/, "/api");
  if (!p.startsWith("/api/")) return null;
  const parts = p.replace(/^\/api/, "").split("/").filter(Boolean);
  const method = req.method;
  const body = method !== "GET" ? await req.json().catch(() => ({})) : {};
  const q = (k: string) => url.searchParams.get(k) ?? "";

  // /api/review/groups[/:id][/diff|/rollback]
  if (parts[0] === "review") {
    if (parts[1] === "groups") {
      if (parts.length === 2 && method === "GET") {
        const entries = await listAudit(env.DB, 100);
        return json(entries.map((a) => ({
          node_uuid: String(a.id),
          display_uri: a.uri || "(system)",
          top_level_table: "audit_logs",
          action: a.op,
          row_count: 1,
        })));
      }
      const id = Number(parts[2]);
      if (parts.length === 3) {
        if (method === "GET") {
          const a = await getAudit(env.DB, id);
          if (!a) return bad("not found", 404);
          const before = a.before_json ? JSON.parse(a.before_json) : {};
          const after = a.after_json ? JSON.parse(a.after_json) : {};
          return json({
            uri: a.uri,
            change_type: a.op === "create" ? "created" : a.op === "delete" ? "deleted" : "modified",
            action: a.op,
            before_content: before.content ?? null,
            current_content: after.content ?? null,
            before_meta: before,
            current_meta: after,
            path_changes: [],
            glossary_changes: [],
            active_paths: a.uri ? [a.uri] : [],
            path_namespaces: {},
            has_changes: true,
          });
        }
        if (method === "DELETE") return json({ ok: true }); // approve = no-op
      }
      if (parts.length === 4 && parts[3] === "rollback" && method === "POST") {
        const r = await rollbackMemory(env.DB, id);
        return json({ node_uuid: String(id), success: r.ok, message: r.message }, r.ok ? 200 : 400);
      }
    }
    if (parts.length === 1 && method === "DELETE") return json({ ok: true });
  }

  // /api/browse/*
  if (parts[0] === "browse") {
    const sub = parts[1];
    if (sub === "domains") {
      if (method === "GET") {
        const entries = await listAll(env.DB);
        const rootCount = entries.filter((e) => !e.uri.includes("/")).length;
        return json([{ domain: "noc", root_count: rootCount }]);
      }
      return bad("not supported");
    }
    if (sub === "namespaces") return json([""]);
    if (sub === "node") {
      const domain = q("domain") || (body as {domain?: string}).domain || "noc";
      const path = q("path") || "";
      if (method === "GET") {
        try {
          const navOnly = q("nav_only") === "true";
          return json(await getNode(env.DB, domain, path, navOnly));
        } catch (e) {
          return bad(e instanceof Error ? e.message : String(e), 404);
        }
      }
      if (method === "DELETE") {
        const uri = `${domain}://${path}`;
        const r = await deleteMemory(env.DB, uri);
        return r.deleted ? json({ success: true }) : bad(r.message, 409);
      }
      if (method === "PUT") {
        const b = body as { content?: string; priority?: number; disclosure?: string | null };
        const r = await updateMemory(env.DB, { uri: `${domain}://${path}`, content: b.content ?? "", priority: b.priority ?? null, disclosure: b.disclosure ?? null, maxContentBytes: maxContentBytes(env) });
        if (!r) return bad("not found", 404);
        return json({ success: true, memory_id: r.memory_id });
      }
      if (method === "POST") {
        // create under parent (path = parent path), content = body.content
        const b = body as { content?: string; priority?: number; disclosure?: string | null; parent_uri?: string };
        const parentUri = b.parent_uri || (path ? `${domain}://${path}` : `${domain}://`);
        const r = await dbCreate(env.DB, {
          parentUri,
          content: b.content ?? "",
          priority: b.priority ?? 0,
          disclosure: b.disclosure ?? null,
          maxContentBytes: maxContentBytes(env),
        });
        return json({ success: true, uri: r.uri, memory_id: 0 });
      }
    }
    if (sub === "node" && parts.length === 3) {
      // /api/browse/node/alias | rename
      if (parts[2] === "alias" && method === "POST") {
        const b = body as { domain?: string; path?: string; alias_domain?: string; alias_path?: string; new_uri?: string; target_uri?: string; priority?: number; disclosure?: string | null };
        const newUri = b.new_uri || `${b.alias_domain || "noc"}://${b.alias_path || ""}`;
        const targetUri = b.target_uri || `${b.domain || "noc"}://${b.path || ""}`;
        const r = await dbAlias(env.DB, newUri, targetUri, b.priority ?? 0, b.disclosure ?? null);
        return r ? json({ success: true }) : bad("alias failed", 409);
      }
      if (parts[2] === "rename") {
        const b = body as { domain?: string; path?: string; new_name?: string };
        const r = await renameNode(env.DB, `${b.domain || "noc"}://${b.path || ""}`, b.new_name || "");
        return r ? json({ success: true, uri: r.uri }) : bad("rename failed (not found or empty name)", 404);
      }
    }
    if (sub === "search") {
      const hits = await searchMemory(env.DB, q("q"), Number(q("limit") || 20));
      // upstream shape: { results: [...] } — frontend reads res.results
      return json({ results: hits });
    }
    if (sub === "glossary") {
      if (method === "GET") return json([]);
      if (method === "POST") {
        const b = body as { keyword?: string; node_uuid?: string };
        await manageTriggers(env.DB, "add", b.keyword ?? "", undefined);
        return json({ success: true });
      }
      if (method === "DELETE") return json({ success: true });
    }
  }

  // /api/maintenance/*
  if (parts[0] === "maintenance") {
    if (parts[1] === "access-logs") {
      if (parts[2] === "stats" && method === "GET") {
        return json({ total: 0, last_30d: 0, top: [] });
      }
      if (method === "DELETE") return json({ success: true });
    }
  }

  // /api/settings*
  if (parts[0] === "settings") {
    if (parts.length === 1) {
      if (method === "GET") return json({});
      return bad("not supported");
    }
    if (parts[1] === "boot-uris") return json({ uris: [] });
    if (parts[1] === "database" && parts[2] === "status" && method === "GET") {
      return json(await dbStatus(env.DB, env.SNAPSHOTS));
    }
  }

  // /api/presets
  if (parts[0] === "presets") return json({ presets: [] });

  return null;
}
