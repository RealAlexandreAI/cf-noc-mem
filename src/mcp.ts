import { Env, maxContentBytes } from "./config";
import {
  addAlias,
  createMemory,
  deleteMemory,
  getNode,
  listAudit,
  manageTriggers,
  readMemory,
  renameNode,
  rollbackMemory,
  searchMemory,
  systemBoot,
  systemBriefing,
  systemDiagnostic,
  systemFocus,
  systemIndex,
  systemRecent,
  updateMemory,
} from "./db";

export const PROTOCOL_VERSION = "2025-06-18";
const SERVER_NAME = "cf-noc-mem";

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: "read_memory",
    description:
      "Reads a memory by URI. Special system URIs: system://boot (boot memories), system://index/<domain>, system://recent[/N], system://briefing (daily working-memory briefing), system://diagnostic/<domain> (memory health).",
    inputSchema: {
      type: "object",
      properties: { uri: { type: "string", description: "Memory URI, e.g. noc://agent/foo or system://recent/5" } },
      required: ["uri"],
    },
  },
  {
    name: "create_memory",
    description: "Creates a memory under an existing parent URI. Requires read_memory on parent first. Optional expires_at (ISO) makes the memory auto-deprecate (Foresight).",
    inputSchema: {
      type: "object",
      properties: {
        parent_uri: { type: "string", description: "Parent node URI, e.g. noc://agent" },
        content: { type: "string", description: "Detailed text content of the memory" },
        title: { type: "string", description: "Explicit path name (slugged). Falls back to the first line of content. Use short ASCII/CJK, e.g. project_notes" },
        priority: { type: "integer", minimum: 0, description: "Retrieval priority, lower first (1,2,3)" },
        disclosure: { type: "string", description: "Optional disclosure note" },
        expires_at: { type: "string", description: "ISO datetime; memory auto-leaves search after this" },
      },
      required: ["parent_uri", "content"],
    },
  },
  {
    name: "update_memory",
    description: "Updates a memory to a new version. Must read_memory(uri) first. Supports full content replace, append, or old_string->new_string block replace. relation marks knowledge evolution: replace|enrich|confirm|challenge.",
    inputSchema: {
      type: "object",
      properties: {
        uri: { type: "string" },
        content: { type: "string", description: "Full replacement content (replaces the whole memory)" },
        old_string: { type: "string", description: "Exact text to replace" },
        new_string: { type: "string", description: "Replacement text" },
        append: { type: "string", description: "Text to append to the end" },
        priority: { type: "integer", minimum: 0 },
        disclosure: { type: "string" },
        expires_at: { type: "string", description: "ISO datetime to expire, or \"\" to clear" },
        relation: { type: "string", enum: ["replace", "enrich", "confirm", "challenge"], description: "Knowledge-evolution relation to previous version" },
      },
      required: ["uri"],
    },
  },
  {
    name: "delete_memory",
    description: "Deletes a memory by cutting its URI path. Returns orphaned children if any must be handled first.",
    inputSchema: {
      type: "object",
      properties: { uri: { type: "string" } },
      required: ["uri"],
    },
  },
  {
    name: "add_alias",
    description: "Creates an alias URI pointing to the same memory as target_uri. Not a copy; children are mirrored.",
    inputSchema: {
      type: "object",
      properties: {
        new_uri: { type: "string" },
        target_uri: { type: "string" },
        priority: { type: "integer", minimum: 0 },
        disclosure: { type: "string" },
      },
      required: ["new_uri", "target_uri"],
    },
  },
  {
    name: "search_memory",
    description: "Full-text searches memories (CJK-friendly trigram FTS with LIKE fallback).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords" },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Max results, default 20" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_memories",
    description: "Lists child memories directly under a parent URI (browse the memory tree). Returns name, path and child count per entry.",
    inputSchema: {
      type: "object",
      properties: {
        uri: { type: "string", description: "Parent URI to list under, e.g. noc://agent or noc:// for root" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Max entries, default 50" },
      },
      required: ["uri"],
    },
  },
  {
    name: "rollback_memory",
    description: "Rolls back a memory change by audit id, restoring the previous state. Audit ids come from recent changes.",
    inputSchema: {
      type: "object",
      properties: {
        audit_id: { type: "integer", description: "Audit log id to roll back" },
      },
      required: ["audit_id"],
    },
  },
  {
    name: "manage_triggers",
    description: "Manage trigger keywords bound to memories. Actions: add (needs target_uri), remove, list.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "remove", "list"] },
        keyword: { type: "string" },
        target_uri: { type: "string" },
      },
      required: ["action", "keyword"],
    },
  },
  {
    name: "rename_memory",
    description: "Renames a memory's path (the URI changes, the node and its content stay). The last path segment is replaced with the new name.",
    inputSchema: {
      type: "object",
      properties: {
        uri: { type: "string", description: "Current URI, e.g. noc://agent/old_name" },
        new_name: { type: "string", description: "New last path segment, e.g. pg_docdb (slugged)" },
      },
      required: ["uri", "new_name"],
    },
  },
  {
    name: "list_audit",
    description: "Lists recent audit entries (create/update/delete/rename/alias) with their audit ids. Pass an audit id to rollback_memory to undo a specific change.",
    inputSchema: {
      type: "object",
      properties: {
        uri: { type: "string", description: "Optional filter: only entries touching this memory URI" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Max entries, default 20" },
      },
    },
  },
];

// ===========================================================================
// JSON-RPC dispatch
// ===========================================================================

export async function handleMcpRequest(body: unknown, env: Env): Promise<Response> {
  const msg = body as { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
  if (!msg || msg.jsonrpc !== "2.0" || !msg.method) {
    return jsonRpcError(msg?.id ?? null, -32600, "Invalid Request");
  }

  // Observability: log the JSON-RPC method + a redacted summary of tool args
  // (only for tools/call — lists/initialize are noise). Never log bearer tokens:
  // args are filtered to safe keys before stringifying.
  if (msg.method === "tools/call") {
    const tool = String(msg.params?.name ?? "");
    const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
    const safe: Record<string, unknown> = {};
    for (const k of Object.keys(args)) {
      if (k === "content" || k === "disclosure" || k === "old_string" || k === "new_string" || k === "append") {
        const s = String(args[k] ?? "");
        safe[k] = s.length > 120 ? s.slice(0, 120) + "…" : s;
      } else {
        safe[k] = args[k];
      }
    }
    console.log(JSON.stringify({ event: "mcp_call", tool, args: safe }));
  }

  switch (msg.method) {
    case "initialize":
      return jsonResult(msg.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: { name: SERVER_NAME, version: "0.1.0" },
      });

    case "notifications/initialized":
      return new Response(null, { status: 202 });

    case "ping":
      return jsonResult(msg.id, {});

    case "tools/list":
      return jsonResult(msg.id, { tools: TOOLS });

    case "tools/call": {
      const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      if (!params.name) return jsonRpcError(msg.id, -32602, "Missing tool name");
      try {
        const result = await callTool(params.name, params.arguments ?? {}, env);
        return jsonResult(msg.id, { content: [{ type: "text", text: String(result) }] });
      } catch (e) {
        return jsonRpcError(msg.id, -32000, e instanceof Error ? e.message : String(e));
      }
    }

    default:
      return jsonRpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

async function callTool(name: string, args: Record<string, unknown>, env: Env): Promise<string> {
  const db = env.DB;
  switch (name) {
    case "read_memory": {
      const uri = String(args.uri ?? "");
      if (uri.startsWith("system://")) {
        return handleSystemUri(db, uri);
      }
      const r = await readMemory(db, uri, "mcp");
      return r ? `${r.uri}\n\n${r.content}` : "Memory not found.";
    }
    case "create_memory": {
      const r = await createMemory(db, {
        parentUri: String(args.parent_uri ?? ""),
        content: String(args.content ?? ""),
        title: args.title == null ? null : String(args.title),
        priority: Number(args.priority ?? 0),
        disclosure: args.disclosure == null ? null : String(args.disclosure),
        expiresAt: args.expires_at == null ? null : String(args.expires_at),
        maxContentBytes: maxContentBytes(env),
      });
      return `Created: ${r.uri} (audit ${r.audit_id})\n\n${r.content}`;
    }
    case "update_memory": {
      const r = await updateMemory(db, {
        uri: String(args.uri ?? ""),
        content: args.content == null ? undefined : String(args.content),
        oldString: args.old_string == null ? null : String(args.old_string),
        newString: args.new_string == null ? null : String(args.new_string),
        append: args.append == null ? null : String(args.append),
        priority: args.priority == null ? null : Number(args.priority),
        disclosure: args.disclosure == null ? null : String(args.disclosure),
        expiresAt: args.expires_at == null ? undefined : String(args.expires_at),
        relation: args.relation == null ? null : String(args.relation),
        maxContentBytes: maxContentBytes(env),
      });
      return r ? `Updated: ${r.uri} (audit ${r.audit_id})\n\n${r.content}` : "Memory not found.";
    }
    case "delete_memory": {
      const r = await deleteMemory(db, String(args.uri ?? ""));
      return r.deleted ? `${r.message} (audit ${r.audit_id})\n${r.orphanChildren.length ? `Orphaned children: ${r.orphanChildren.join(", ")}` : ""}`.trim() : `${r.message}${r.orphanChildren.length ? `\nOrphaned children: ${r.orphanChildren.join(", ")}` : ""}`;
    }
    case "add_alias": {
      const r = await addAlias(
        db,
        String(args.new_uri ?? ""),
        String(args.target_uri ?? ""),
        Number(args.priority ?? 0),
        args.disclosure == null ? null : String(args.disclosure)
      );
      return r ? `Alias created: ${r.uri}\n\n${r.content}` : "Alias failed: target not found or path exists.";
    }
    case "search_memory": {
      const hits = await searchMemory(db, String(args.query ?? ""), Number(args.limit ?? 20));
      if (hits.length === 0) return "(no results)";
      return `[${hits.length} hits]\n` + hits.map((h) => `${h.uri} [p${h.priority}]\n${h.snippet}`).join("\n\n");
    }
    case "list_memories": {
      const uri = String(args.uri ?? "");
      const { domain, path } = parseUriLocal(uri);
      const node = await getNode(db, domain, path, true);
      const limit = Math.max(1, Math.min(Number(args.limit ?? 50), 100));
      const children = (node.children ?? []).slice(0, limit);
      if (children.length === 0) return "(no children)";
      return children
        .map((c) => `${c.uri || `${domain}://${c.path}`}${c.approx_children_count ? ` (${c.approx_children_count} sub)` : ""}`)
        .join("\n");
    }
    case "rollback_memory": {
      const r = await rollbackMemory(db, Number(args.audit_id ?? 0));
      return r.ok ? r.message : `Rollback failed: ${r.message}`;
    }
    case "manage_triggers": {
      const r = await manageTriggers(db, String(args.action ?? ""), String(args.keyword ?? ""), args.target_uri == null ? undefined : String(args.target_uri));
      return r.message;
    }
    case "rename_memory": {
      const r = await renameNode(db, String(args.uri ?? ""), String(args.new_name ?? ""));
      return r ? `Renamed to: ${r.uri}` : "Rename failed: not found or empty name.";
    }
    case "list_audit": {
      const entries = await listAudit(db, Number(args.limit ?? 20), args.uri == null ? undefined : String(args.uri));
      if (entries.length === 0) return "(no audit entries)";
      return entries.map((a) => `#${a.id} ${a.op} ${a.uri ?? "(none)"}${a.relation ? ` relation=${a.relation}` : ""} @ ${a.created_at}`).join("\n");
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleSystemUri(db: D1Database, uri: string): Promise<string> {
  const rest = uri.replace(/^system:\/\//, "");
  if (rest === "boot") return systemBoot(db);
  if (rest === "briefing") return systemBriefing(db);
  if (rest === "focus") return systemFocus(db);
  if (rest.startsWith("diagnostic/")) {
    return systemDiagnostic(db, rest.slice("diagnostic/".length));
  }
  if (rest.startsWith("index/")) {
    const items = await systemIndex(db, rest.slice("index/".length));
    return items.map((i) => `${i.uri}: ${i.title}`).join("\n") || "(empty)";
  }
  if (rest === "recent" || rest.startsWith("recent/")) {
    const n = rest.startsWith("recent/") ? parseInt(rest.slice("recent/".length), 10) : 10;
    const items = await systemRecent(db, Number.isFinite(n) ? n : 10);
    return items.map((i) => `${i.uri}: ${i.title}`).join("\n") || "(empty)";
  }
  return "Unknown system URI. Use system://boot, system://briefing, system://focus, system://index/<domain>, system://recent[/N], system://diagnostic/<domain>.";
}

// ===========================================================================
// JSON-RPC helpers
// ===========================================================================

function parseUriLocal(uri: string): { domain: string; path: string } {
  const m = /^([a-z][a-z0-9-]*):\/\/(.*)$/i.exec(uri.trim());
  if (m) return { domain: m[1].toLowerCase(), path: m[2].replace(/^\/+|\/+$/g, "") };
  return { domain: "noc", path: uri.trim().replace(/^\/+|\/+$/g, "") };
}

function jsonResult(id: unknown, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function jsonRpcError(id: unknown, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }), {
    status: code === -32600 ? 400 : 200,
    headers: { "content-type": "application/json" },
  });
}
