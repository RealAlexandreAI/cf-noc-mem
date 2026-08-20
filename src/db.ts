import { Env } from "./config";

export const ROOT_NODE = "00000000-0000-0000-0000-000000000000";
// Single-user build: the memory tree IS the memory. No namespaces, no
// multi-tenant domains — everything lives under one "noc" domain.
export const DEFAULT_DOMAIN = "noc";

export interface ParsedUri {
  domain: string;
  path: string; // normalized, no leading/trailing slash
}

export function parseUri(uri: string): ParsedUri {
  const m = /^([a-z][a-z0-9-]*):\/\/(.*)$/i.exec(uri.trim());
  if (m) {
    return { domain: m[1].toLowerCase(), path: m[2].replace(/^\/+|\/+$/g, "") };
  }
  return { domain: DEFAULT_DOMAIN, path: uri.trim().replace(/^\/+|\/+$/g, "") };
}

export function makeUri(domain: string, path: string): string {
  return `${domain}://${path}`;
}

interface PathRow {
  edge_id: number | null;
  node_uuid: string | null;
}

async function resolvePathRow(db: D1Database, domain: string, path: string): Promise<PathRow | null> {
  return db
    .prepare("SELECT edge_id, node_uuid FROM paths WHERE domain = ? AND path = ?")
    .bind(domain, path)
    .first<PathRow>();
}

interface MemoryRow {
  id: number;
  node_uuid: string;
  content: string;
  deprecated: number;
  migrated_to: number | null;
  created_at: string;
  expires_at?: string | null;
}

async function activeMemoryForNode(db: D1Database, nodeUuid: string): Promise<MemoryRow | null> {
  return db
    .prepare(
      "SELECT id, node_uuid, content, deprecated, migrated_to, created_at, expires_at FROM memories WHERE node_uuid = ? AND deprecated = 0 ORDER BY id DESC LIMIT 1"
    )
    .bind(nodeUuid)
    .first<MemoryRow>();
}

interface EdgeRow {
  id: number;
  parent_uuid: string;
  child_uuid: string;
  name: string;
  priority: number;
  disclosure: string | null;
}

function nowSql(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// Normalize any ISO/date input to the SQL format used by nowSql() so string
// comparisons (expiry checks) stay consistent.
function toSqlTime(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString().replace("T", " ").slice(0, 19);
}

async function logAccess(db: D1Database, nodeUuid: string, context?: string): Promise<void> {
  await db
    .prepare("INSERT INTO memory_access_logs (node_uuid, accessed_at, context) VALUES (?, ?, ?)")
    .bind(nodeUuid, nowSql(), context ?? null)
    .run();
  await db
    .prepare("UPDATE nodes SET last_accessed_at = ? WHERE uuid = ?")
    .bind(nowSql(), nodeUuid)
    .run();
}

async function recordAudit(
  db: D1Database,
  op: string,
  uri: string | null,
  nodeUuid: string | null,
  before: unknown,
  after: unknown,
  relation?: string
): Promise<number> {
  const r = await db
    .prepare("INSERT INTO audit_logs (op, node_uuid, uri, before_json, after_json, relation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(op, nodeUuid, uri, before === null ? null : JSON.stringify(before), JSON.stringify(after), relation ?? null, nowSql())
    .run();
  return Number(r.meta.last_row_id);
}

// ===========================================================================
// read
// ===========================================================================

export interface ReadResult {
  uri: string;
  content: string;
  priority: number;
  disclosure: string | null;
  node_uuid: string;
  memory_id: number;
  created_at: string;
  updated_at: string;
  expires_at?: string | null;
}

export async function readMemory(db: D1Database, uri: string, context?: string): Promise<ReadResult | null> {
  const { domain, path } = parseUri(uri);
  const row = await resolvePathRow(db, domain, path);
  if (!row || !row.node_uuid) return null;

  const mem = await activeMemoryForNode(db, row.node_uuid);
  if (!mem) return null;

  const edge = row.edge_id
    ? await db.prepare("SELECT id, parent_uuid, child_uuid, name, priority, disclosure FROM edges WHERE id = ?").bind(row.edge_id).first<EdgeRow>()
    : null;

  await logAccess(db, row.node_uuid, context);

  // Foresight: surface expiry so callers know this memory has a shelf life
  const expiresAt = (mem as { expires_at?: string | null }).expires_at ?? null;
  const expired = expiresAt ? expiresAt < nowSql() : false;
  const content = expired ? `[expired ${expiresAt}] ${mem.content}` : mem.content;

  return {
    uri: makeUri(domain, path),
    content,
    priority: edge?.priority ?? 0,
    disclosure: edge?.disclosure ?? null,
    node_uuid: row.node_uuid,
    memory_id: mem.id,
    created_at: mem.created_at,
    updated_at: mem.created_at,
    expires_at: expiresAt,
  };
}

// ===========================================================================
// create
// ===========================================================================

export interface CreateInput {
  parentUri: string;
  content: string;
  priority: number;
  disclosure: string | null;
  expiresAt?: string | null; // ISO time; memory auto-deprecates after this (Foresight)
  title?: string | null; // explicit path name; falls back to first line of content
  maxContentBytes?: number;
}

export async function createMemory(db: D1Database, input: CreateInput): Promise<{ uri: string; content: string; audit_id: number }> {
  const { domain: parentDomain, path: parentPath } = parseUri(input.parentUri);
  const maxBytes = input.maxContentBytes ?? 65536;

  // validation: an empty memory (no title, no content) is a mistake
  if (!input.title?.trim() && !input.content.trim()) {
    throw new Error("content is empty");
  }
  if (input.content.length > maxBytes) {
    throw new Error(`content too large (max ${maxBytes} bytes)`);
  }
  const parent = await resolvePathRow(db, parentDomain, parentPath);
  // creating under a non-root path that does not exist would build ghost hierarchy
  if (parentPath && !parent?.node_uuid) {
    throw new Error(`parent not found: ${input.parentUri}`);
  }
  const parentNode = parent?.node_uuid ?? ROOT_NODE;

  // path name: explicit title wins; otherwise last segment of the first content line
  const title = (input.title?.trim() || input.content.split("\n")[0].trim().slice(0, 80) || "untitled");
  const childPath = `${parentPath ? parentPath + "/" : ""}${slugify(title)}`;

  // uniqueness: if path already exists, append suffix
  const childPathFinal = await uniquePath(db, parentDomain, childPath);

  const nodeUuid = crypto.randomUUID();
  await db.prepare("INSERT INTO nodes (uuid, created_at) VALUES (?, ?)").bind(nodeUuid, nowSql()).run();
  const edgeId = await db
    .prepare("INSERT INTO edges (parent_uuid, child_uuid, name, priority, disclosure, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(parentNode, nodeUuid, title, input.priority, input.disclosure, nowSql())
    .run()
    .then((r) => Number(r.meta.last_row_id));

  const memoryId = await db
    .prepare("INSERT INTO memories (node_uuid, content, deprecated, migrated_to, created_at, expires_at) VALUES (?, ?, 0, NULL, ?, ?)")
    .bind(nodeUuid, input.content, nowSql(), input.expiresAt ? toSqlTime(input.expiresAt) : null)
    .run()
    .then((r) => Number(r.meta.last_row_id));

  await db
    .prepare("INSERT INTO paths (domain, path, edge_id, node_uuid, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(parentDomain, childPathFinal, edgeId, nodeUuid, nowSql())
    .run();

  await upsertSearchDocument(db, parentDomain, childPathFinal, nodeUuid, memoryId, input.content, input.disclosure, input.priority);
  const auditId = await recordAudit(db, "create", makeUri(parentDomain, childPathFinal), nodeUuid, null, {
    node_uuid: nodeUuid,
    memory_id: memoryId,
    edge_id: edgeId,
  });

  return { uri: makeUri(parentDomain, childPathFinal), content: input.content, audit_id: auditId };
}

function slugify(title: string): string {
  // keep letters, digits, hyphens, underscores, CJK; replace the rest with _
  const s = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return s || "untitled";
}

async function uniquePath(db: D1Database, domain: string, base: string): Promise<string> {
  const exists = await db.prepare("SELECT 1 FROM paths WHERE domain = ? AND path = ?").bind(domain, base).first();
  if (!exists) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}`;
    const hit = await db.prepare("SELECT 1 FROM paths WHERE domain = ? AND path = ?").bind(domain, candidate).first();
    if (!hit) return candidate;
  }
  return `${base}_${Date.now()}`;
}

// ===========================================================================
// update
// ===========================================================================

export interface UpdateInput {
  uri: string;
  content?: string | null; // full replace (upstream PUT /browse/node)
  oldString?: string | null;
  newString?: string | null;
  append?: string | null;
  priority?: number | null;
  disclosure?: string | null;
  expiresAt?: string | null; // Foresight: set or clear (null keeps current? use "" to clear)
  relation?: string | null; // knowledge-evolution marker: replace|enrich|confirm|challenge
  maxContentBytes?: number;
}

export async function updateMemory(db: D1Database, input: UpdateInput): Promise<(ReadResult & { audit_id?: number }) | null> {
  const { domain, path } = parseUri(input.uri);
  const row = await resolvePathRow(db, domain, path);
  if (!row || !row.node_uuid) return null;

  const cur = await activeMemoryForNode(db, row.node_uuid);
  if (!cur) return null;
  const maxBytes = input.maxContentBytes ?? 65536;

  let content = cur.content;
  if (input.content != null) {
    content = input.content;
  } else if (input.append != null) {
    content = content + "\n" + input.append;
  } else if (input.oldString != null) {
    if (input.newString == null) {
      content = content.replace(input.oldString, "");
    } else {
      content = content.split(input.oldString).join(input.newString);
    }
  }
  if (content.length > maxBytes) {
    throw new Error(`content too large (max ${maxBytes} bytes)`);
  }

  const now = nowSql();
  await db
    .prepare("UPDATE memories SET deprecated = 1, migrated_to = NULL WHERE id = ?")
    .bind(cur.id)
    .run();
  // Foresight: expiresAt="" clears it, explicit value sets it, undefined keeps current
  const newExpiry = input.expiresAt === "" ? null : (input.expiresAt ? toSqlTime(input.expiresAt) : (cur.expires_at ?? null));
  const newId = await db
    .prepare("INSERT INTO memories (node_uuid, content, deprecated, migrated_to, created_at, expires_at) VALUES (?, ?, 0, NULL, ?, ?)")
    .bind(row.node_uuid, content, now, newExpiry)
    .run()
    .then((r) => Number(r.meta.last_row_id));
  await db
    .prepare("UPDATE memories SET migrated_to = ? WHERE id = ?")
    .bind(newId, cur.id)
    .run();

  if (row.edge_id) {
    await db
      .prepare("UPDATE edges SET priority = COALESCE(?, priority), disclosure = COALESCE(?, disclosure) WHERE id = ?")
      .bind(input.priority ?? null, input.disclosure ?? null, row.edge_id)
      .run();
  }

  const edge = row.edge_id
    ? await db.prepare("SELECT priority, disclosure FROM edges WHERE id = ?").bind(row.edge_id).first<{ priority: number; disclosure: string | null }>()
    : null;
  const finalPriority = input.priority ?? edge?.priority ?? 0;
  const finalDisclosure = input.disclosure ?? edge?.disclosure ?? null;

  await upsertSearchDocument(db, domain, path, row.node_uuid, newId, content, finalDisclosure, finalPriority);
  const auditId = await recordAudit(db, "update", input.uri, row.node_uuid, { memory_id: cur.id, content: cur.content }, { memory_id: newId, content }, input.relation ?? undefined);

  return {
    uri: makeUri(domain, path),
    content,
    priority: finalPriority,
    disclosure: finalDisclosure,
    node_uuid: row.node_uuid,
    memory_id: newId,
    created_at: cur.created_at,
    updated_at: now,
    audit_id: auditId,
  };
}

// ===========================================================================
// delete
// ===========================================================================

export interface DeleteResult {
  deleted: boolean;
  message: string;
  orphanChildren: string[];
  audit_id?: number | null;
}

export async function deleteMemory(db: D1Database, uri: string): Promise<DeleteResult> {
  const { domain, path } = parseUri(uri);
  const row = await resolvePathRow(db, domain, path);
  if (!row || !row.node_uuid) return { deleted: false, message: "Path not found", orphanChildren: [] };

  const nodeUuid = row.node_uuid;
  const mem = await activeMemoryForNode(db, nodeUuid);

  // children of this node
  const children = await db
    .prepare("SELECT child_uuid FROM edges WHERE parent_uuid = ?")
    .bind(nodeUuid)
    .all<{ child_uuid: string }>();
  const orphanChildren: string[] = [];
  for (const c of children.results ?? []) {
    const otherPaths = await db.prepare("SELECT COUNT(*) AS n FROM paths WHERE node_uuid = ?").bind(c.child_uuid).first<{ n: number }>();
    if ((otherPaths?.n ?? 0) === 0) orphanChildren.push(c.child_uuid);
  }
  if (orphanChildren.length > 0) {
    return {
      deleted: false,
      message: `Node has orphaned children. Handle first: ${orphanChildren.join(", ")}`,
      orphanChildren,
    };
  }

  const before = { node_uuid: nodeUuid, memory_id: mem?.id ?? null, content: mem?.content ?? null, path };
  await db.prepare("DELETE FROM paths WHERE domain = ? AND path = ?").bind(domain, path).run();
  if (row.edge_id) {
    const edgeRefs = await db.prepare("SELECT COUNT(*) AS n FROM paths WHERE edge_id = ?").bind(row.edge_id).first<{ n: number }>();
    if ((edgeRefs?.n ?? 0) === 0) {
      await db.prepare("DELETE FROM edges WHERE id = ?").bind(row.edge_id).run();
    }
  }
  // node no longer referenced anywhere -> hard delete graph
  const nodeRefs = await db
    .prepare("SELECT (SELECT COUNT(*) FROM paths WHERE node_uuid = ?) + (SELECT COUNT(*) FROM edges WHERE parent_uuid = ? OR child_uuid = ?) AS n")
    .bind(nodeUuid, nodeUuid, nodeUuid)
    .first<{ n: number }>();
  if ((nodeRefs?.n ?? 0) === 0) {
    await removeSearchDocument(db, domain, path, nodeUuid);
    await db.prepare("DELETE FROM triggers WHERE node_uuid = ?").bind(nodeUuid).run();
    await db.prepare("DELETE FROM memories WHERE node_uuid = ?").bind(nodeUuid).run();
    await db.prepare("DELETE FROM nodes WHERE uuid = ?").bind(nodeUuid).run();
  } else {
    // node still referenced by other paths/edges — drop just this path's index entry
    await removeSearchDocument(db, domain, path);
  }
  const auditId = await recordAudit(db, "delete", uri, nodeUuid, before, null);
  return { deleted: true, message: "Deleted", orphanChildren: [], audit_id: auditId };
}

// ===========================================================================
// alias
// ===========================================================================

export async function addAlias(
  db: D1Database,
  newUri: string,
  targetUri: string,
  priority: number,
  disclosure: string | null
): Promise<ReadResult | null> {
  const target = await resolvePathRow(db, parseUri(targetUri).domain, parseUri(targetUri).path);
  if (!target || !target.node_uuid) return null;

  const { domain, path } = parseUri(newUri);
  const mem = await activeMemoryForNode(db, target.node_uuid);
  if (!mem) return null;

  const exists = await db.prepare("SELECT 1 FROM paths WHERE domain = ? AND path = ?").bind(domain, path).first();
  if (exists) return null;

  // alias: new path row referencing the same edge/node; independent priority/disclosure
  let edgeId = target.edge_id;
  if (target.edge_id) {
    await db
      .prepare("UPDATE edges SET priority = ?, disclosure = ? WHERE id = ?")
      .bind(priority, disclosure, target.edge_id)
      .run();
  } else {
    const r = await db
      .prepare("INSERT INTO edges (parent_uuid, child_uuid, name, priority, disclosure, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(ROOT_NODE, target.node_uuid, path.split("/").pop() ?? path, priority, disclosure, nowSql())
      .run();
    edgeId = Number(r.meta.last_row_id);
  }

  await db
    .prepare("INSERT INTO paths (domain, path, edge_id, node_uuid, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(domain, path, edgeId, target.node_uuid, nowSql())
    .run();
  await upsertSearchDocument(db, domain, path, target.node_uuid, mem.id, mem.content, disclosure, priority);
  await recordAudit(db, "alias", newUri, target.node_uuid, null, { target_uri: targetUri });

  return readMemory(db, newUri);
}

// ===========================================================================
// rename — change the path of an existing memory (URI changes, node stays)
// ===========================================================================

export async function renameNode(db: D1Database, uri: string, newName: string): Promise<{ uri: string } | null> {
  const { domain, path } = parseUri(uri);
  const row = await resolvePathRow(db, domain, path);
  if (!row || !row.node_uuid) return null;

  const base = newName.trim().replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 64);
  if (!base) return null;

  const segs = path.split("/");
  segs[segs.length - 1] = base;
  const newPath = await uniquePath(db, domain, segs.join("/"));
  if (newPath === path) return { uri }; // no-op

  // node is shared by alias paths — only this path segment changes
  await db.prepare("UPDATE paths SET path = ? WHERE domain = ? AND path = ?").bind(newPath, domain, path).run();
  // rebuild search entry: remove old path's document, index the new path
  await removeSearchDocument(db, domain, path);
  const mem = await activeMemoryForNode(db, row.node_uuid);
  const edge = row.edge_id ? await db.prepare("SELECT priority, disclosure FROM edges WHERE id = ?").bind(row.edge_id).first<{ priority: number; disclosure: string | null }>() : null;
  await upsertSearchDocument(db, domain, newPath, row.node_uuid, mem?.id ?? 0, mem?.content ?? "", edge?.disclosure ?? null, edge?.priority ?? 0);

  // cascade: rewrite descendant paths that hang under the old prefix so the
  // tree's URIs stay consistent after the parent is renamed
  const descendants: string[] = [];
  const seen = new Set<string>([row.node_uuid]);
  const queue = [row.node_uuid];
  while (queue.length > 0) {
    const parentUuid = queue.shift()!;
    const kids = await db.prepare("SELECT child_uuid FROM edges WHERE parent_uuid = ?").bind(parentUuid).all<{ child_uuid: string }>();
    for (const k of kids.results ?? []) {
      if (seen.has(k.child_uuid)) continue;
      seen.add(k.child_uuid);
      descendants.push(k.child_uuid);
      queue.push(k.child_uuid);
    }
  }
  for (const nodeUuid of descendants) {
    const pRows = await db.prepare("SELECT path, edge_id FROM paths WHERE domain = ? AND node_uuid = ?").bind(domain, nodeUuid).all<{ path: string; edge_id: number | null }>();
    for (const p of pRows.results ?? []) {
      if (!p.path.startsWith(path + "/")) continue; // only paths under the old prefix
      const childNewPath = newPath + p.path.slice(path.length);
      await db.prepare("UPDATE paths SET path = ? WHERE domain = ? AND path = ?").bind(childNewPath, domain, p.path).run();
      await removeSearchDocument(db, domain, p.path);
      const cMem = await activeMemoryForNode(db, nodeUuid);
      const cEdge = p.edge_id ? await db.prepare("SELECT priority, disclosure FROM edges WHERE id = ?").bind(p.edge_id).first<{ priority: number; disclosure: string | null }>() : null;
      await upsertSearchDocument(db, domain, childNewPath, nodeUuid, cMem?.id ?? 0, cMem?.content ?? "", cEdge?.disclosure ?? null, cEdge?.priority ?? 0);
    }
  }

  await recordAudit(db, "rename", `${domain}://${newPath}`, row.node_uuid, { from: `${domain}://${path}` }, { to: `${domain}://${newPath}`, cascaded: descendants.length });

  return { uri: makeUri(domain, newPath) };
}

// ===========================================================================
// search
// ===========================================================================

export interface SearchHit {
  uri: string;
  node_uuid: string;
  memory_id: number;
  priority: number;
  snippet: string;
}

// English stopwords for the FTS token-OR fallback (noise tokens dilute ranking).
const STOPWORDS = new Set([
  "what", "when", "where", "which", "who", "whom", "whose", "why", "how",
  "the", "and", "with", "from", "that", "this", "these", "those", "have", "has",
  "been", "were", "was", "did", "does", "do", "will", "would", "should", "could",
  "can", "there", "their", "they", "them", "then", "than", "about", "into", "over",
  "after", "before", "during", "between", "through", "your", "you", "her", "his",
  "its", "our", "their", "going", "come", "came", "goes", "went", "said", "says",
  "told", "tell", "think", "thought", "know", "knew", "want", "wanted", "need",
  "like", "liked", "make", "made", "get", "got", "give", "gave", "take", "took",
  "been", "also", "just", "very", "really", "much", "many", "more", "most",
  "something", "anything", "nothing", "everything", "some", "any", "all", "one",
  "two", "today", "yesterday", "tomorrow", "tonight", "morning", "evening", "now",
  "here", "there", "back", "again", "never", "always", "sure", "maybe", "perhaps",
  "thank", "thanks", "okay", "fine", "well", "good", "great", "love", "sorry",
]);

export async function searchMemory(db: D1Database, query: string, limit: number = 20): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];

  // Expired memories (Foresight) are excluded from retrieval even before the
  // auto-forget cron deprecates them — an expired memory is no longer "true".
  const expiredUris = new Set(
    (await db
      .prepare(
        `SELECT p.domain || '://' || p.path AS uri
         FROM paths p JOIN memories m ON m.node_uuid = p.node_uuid AND m.deprecated = 0
         WHERE m.expires_at IS NOT NULL AND m.expires_at < ?`
      )
      .bind(nowSql())
      .all<{ uri: string }>())
      .results?.map((r) => r.uri) ?? []
  );
  const notExpired = (hits: SearchHit[]) => hits.filter((h) => !expiredUris.has(h.uri));

  // Trigger-keyword recall: exact or substring match on the triggers table
  // (keywords are the memory's "call sign" — they rank above content FTS).
  // Relevance: exact keyword match ranks first; substring match requires the
  // keyword to be >=3 chars (short keywords like "ai" would over-match any word
  // containing them); a node is returned once even if several keywords hit.
  const triggerHits = await db
    .prepare(
      `SELECT p.domain || '://' || p.path AS uri, t.node_uuid AS node_uuid, m.id AS memory_id,
              e.priority, substr(m.content, 1, 200) AS snippet
       FROM triggers t
       JOIN paths p ON p.node_uuid = t.node_uuid
       JOIN edges e ON e.id = p.edge_id
       JOIN memories m ON m.node_uuid = t.node_uuid AND m.deprecated = 0
       WHERE t.keyword = ? OR (length(t.keyword) >= 3 AND ? LIKE '%' || t.keyword || '%')
       GROUP BY p.domain, p.path
       ORDER BY CASE WHEN t.keyword = ? THEN 0 ELSE 1 END, e.priority ASC
       LIMIT ?`
    )
    .bind(q, q, q, limit)
    .all<SearchHit>()
    .then((r) => r.results ?? []);

  // Reconstructive recollection (EverOS principle): if a trigger keyword
  // matched, that IS the precise recall — return trigger hits as-is, no FTS
  // noise. Only when triggers miss do we fall through to FTS/LIKE.
  if (triggerHits.length > 0) {
    return notExpired(triggerHits).map((h) => ({ ...h, snippet: "[trigger] " + h.snippet }));
  }

  let rows: SearchHit[] = [];
  if (q.length >= 3) {
    // trigram FTS: phrase match first (precise), ranked by rowid.
    rows = await db
      .prepare(
        `SELECT uri, '' AS node_uuid, 0 AS memory_id, CAST(search_terms AS INTEGER) AS priority, substr(content, 1, 200) AS snippet
         FROM search_fts WHERE search_fts MATCH ?
         ORDER BY rowid
         LIMIT ?`
      )
      .bind(`"${q.replace(/"/g, "")}"`, limit)
      .all<SearchHit>()
      .then((r) => r.results ?? []);

    // Long natural-language queries (e.g. "When did Caroline go to the
    // LGBTQ support group?") almost never match as a quoted phrase. Fall
    // back to OR of significant tokens so the retriever still surfaces the
    // relevant turns. rank() is FTS5's built-in BM25-style score (lower=better).
    if (rows.length === 0) {
      const tokens = q
        .split(/[^\p{L}\p{N}]+/u)
        .map((t) => t.toLowerCase())
        .filter((t) => t.length >= 4 && !STOPWORDS.has(t) && !/^\d/.test(t));
      if (tokens.length > 0) {
        const orQuery = tokens.map((t) => `"${t}"`).join(" OR ");
        rows = await db
          .prepare(
            `SELECT uri, '' AS node_uuid, 0 AS memory_id, CAST(search_terms AS INTEGER) AS priority, substr(content, 1, 200) AS snippet
             FROM search_fts WHERE search_fts MATCH ?
             ORDER BY rank
             LIMIT ?`
          )
          .bind(orQuery, limit)
          .all<SearchHit>()
          .then((r) => r.results ?? []);
      }
    }
  }

  if (rows.length === 0) {
    // short query or FTS miss -> LIKE fallback over uri + content
    const like = `%${q}%`;
    rows = await db
      .prepare(
        `SELECT uri, node_uuid, memory_id, priority, substr(content, 1, 200) AS snippet
         FROM search_documents
         WHERE uri LIKE ? OR content LIKE ?
         ORDER BY priority ASC, updated_at DESC
         LIMIT ?`
      )
      .bind(like, like, limit)
      .all<SearchHit>()
      .then((r) => r.results ?? []);
  }

  return notExpired(rows);
}

// ===========================================================================
// triggers
// ===========================================================================

export interface TriggerResult {
  action: string;
  keyword: string;
  target_uri?: string;
  matched: boolean;
  message: string;
}

export async function manageTriggers(
  db: D1Database,
  action: string,
  keyword: string,
  targetUri?: string
): Promise<TriggerResult> {
  const kw = keyword.trim();
  switch (action) {
    case "add": {
      if (!targetUri) return { action, keyword: kw, matched: false, message: "target_uri required for add" };
      const row = await resolvePathRow(db, parseUri(targetUri).domain, parseUri(targetUri).path);
      if (!row?.node_uuid) return { action, keyword: kw, target_uri: targetUri, matched: false, message: "target not found" };
      await db.prepare("INSERT OR IGNORE INTO triggers (keyword, node_uuid, created_at) VALUES (?, ?, ?)").bind(kw, row.node_uuid, nowSql()).run();
      return { action, keyword: kw, target_uri: targetUri, matched: true, message: `Trigger added: ${kw} -> ${targetUri}` };
    }
    case "remove": {
      const del = await db.prepare("DELETE FROM triggers WHERE keyword = ?").bind(kw).run();
      return { action, keyword: kw, matched: (del.meta.changes ?? 0) > 0, message: `Removed trigger: ${kw}` };
    }
    case "list": {
      const rows = await db.prepare("SELECT keyword, node_uuid FROM triggers ORDER BY keyword").all<{ keyword: string; node_uuid: string }>();
      const list = (rows.results ?? []).map((r) => `${r.keyword} -> ${r.node_uuid}`).join("\n");
      return { action, keyword: kw, matched: (rows.results ?? []).length > 0, message: list || "No triggers" };
    }
    default:
      return { action, keyword: kw, matched: false, message: `Unknown action: ${action} (add|remove|list)` };
  }
}

// ===========================================================================
// system URIs
// ===========================================================================

export interface SystemIndex {
  uri: string;
  title: string;
  updated_at: string;
}

export async function systemBoot(db: D1Database): Promise<string> {
  // root-level memories, highest priority first
  const rows = await db
    .prepare(
      `SELECT e.name, e.priority, p.domain, p.path FROM edges e
       JOIN paths p ON p.edge_id = e.id
       WHERE e.parent_uuid = ? ORDER BY e.priority ASC, e.created_at ASC`
    )
    .bind(ROOT_NODE)
    .all<{ name: string; priority: number; domain: string; path: string }>();
  return (rows.results ?? []).map((r) => `${r.priority} ${makeUri(r.domain, r.path)}: ${r.name}`).join("\n") || "(empty)";
}

export async function systemIndex(db: D1Database, domain: string): Promise<SystemIndex[]> {
  const rows = await db
    .prepare(
      `SELECT p.domain, p.path, e.name AS title, e.created_at AS updated_at
       FROM paths p JOIN edges e ON e.id = p.edge_id
       WHERE p.domain = ? ORDER BY e.created_at DESC`
    )
    .bind(domain || DEFAULT_DOMAIN)
    .all<{ domain: string; path: string; title: string; updated_at: string }>();
  return (rows.results ?? []).map((r) => ({ uri: makeUri(r.domain, r.path), title: r.title, updated_at: r.updated_at }));
}

export async function systemRecent(db: D1Database, n: number): Promise<SystemIndex[]> {
  const rows = await db
    .prepare(
      `SELECT p.domain, p.path, e.name AS title, m.created_at AS updated_at
       FROM paths p JOIN edges e ON e.id = p.edge_id JOIN memories m ON m.node_uuid = p.node_uuid AND m.deprecated = 0
       ORDER BY m.created_at DESC LIMIT ?`
    )
    .bind(Math.max(1, Math.min(n, 100)))
    .all<{ domain: string; path: string; title: string; updated_at: string }>();
  return (rows.results ?? []).map((r) => ({ uri: makeUri(r.domain, r.path), title: r.title, updated_at: r.updated_at }));
}

/**
 * Daily working-memory briefing (Mem-style). Dynamically assembled, no cron
 * persistence needed: agent reads system://briefing at session start to get
 * (1) recent activity, (2) top-priority memories, (3) items due to expire,
 * (4) cold candidates that will be forgotten soon. Pure SQL, zero deps.
 */
export async function systemBriefing(db: D1Database): Promise<string> {
  const recent = await systemRecent(db, 10);
  const top = await db
    .prepare(
      `SELECT p.domain, p.path, e.name AS title, e.priority
       FROM paths p JOIN edges e ON e.id = p.edge_id JOIN memories m ON m.node_uuid = p.node_uuid AND m.deprecated = 0
       WHERE e.priority <= 1 AND p.path != ''
       ORDER BY e.priority ASC, m.created_at DESC LIMIT 8`
    )
    .all<{ domain: string; path: string; title: string; priority: number }>();
  const expiring = await db
    .prepare(
      `SELECT p.domain, p.path, e.name AS title, m.expires_at
       FROM paths p JOIN edges e ON e.id = p.edge_id JOIN memories m ON m.node_uuid = p.node_uuid AND m.deprecated = 0
       WHERE m.expires_at IS NOT NULL AND m.expires_at > ? AND m.expires_at < ?
       ORDER BY m.expires_at ASC LIMIT 5`
    )
    .bind(nowSql(), new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 19).replace("T", " "))
    .all<{ domain: string; path: string; title: string; expires_at: string }>();
  const cold = await db
    .prepare(
      `SELECT p.domain, p.path, e.name AS title, e.priority, n.last_accessed_at
       FROM nodes n JOIN paths p ON p.node_uuid = n.uuid JOIN edges e ON e.id = p.edge_id
       WHERE (n.last_accessed_at IS NULL OR n.last_accessed_at < ?) AND e.priority > 3 AND p.path != ''
       ORDER BY e.priority DESC LIMIT 5`
    )
    .bind(new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 19).replace("T", " "))
    .all<{ domain: string; path: string; title: string; priority: number; last_accessed_at: string | null }>();

  const lines: string[] = ["# Working Memory Briefing", `generated: ${new Date().toISOString()}`, ""];
  lines.push("## Recent activity");
  for (const r of recent) lines.push(`- ${r.uri}: ${r.title}`);
  lines.push("", "## Top priority");
  for (const t of top.results ?? []) lines.push(`- [p${t.priority}] ${makeUri(t.domain, t.path)}: ${t.title}`);
  if ((expiring.results ?? []).length) {
    lines.push("", "## Expiring this week");
    for (const e of expiring.results ?? []) lines.push(`- ${makeUri(e.domain, e.path)} (${e.title}) until ${e.expires_at}`);
  }
  if ((cold.results ?? []).length) {
    lines.push("", "## Cold (candidates for forgetting)");
    for (const c of cold.results ?? []) lines.push(`- [p${c.priority}] ${makeUri(c.domain, c.path)}: ${c.title} (last seen ${c.last_accessed_at ?? "never"})`);
  }
  return lines.join("\n");
}

// ===========================================================================
// health diagnostics (system://diagnostic/<domain>)
// ===========================================================================

export async function systemDiagnostic(db: D1Database, domain: string): Promise<string> {
  const dom = domain || DEFAULT_DOMAIN;
  const active = await db
    .prepare(
      `SELECT p.path, p.node_uuid, e.name AS title, e.priority, n.last_accessed_at, m.expires_at, m.created_at
       FROM paths p JOIN edges e ON e.id = p.edge_id JOIN memories m ON m.node_uuid = p.node_uuid AND m.deprecated = 0
       JOIN nodes n ON n.uuid = p.node_uuid
       WHERE p.domain = ? AND p.path != ''
       ORDER BY e.priority ASC`
    )
    .bind(dom)
    .all<{ path: string; node_uuid: string; title: string; priority: number; last_accessed_at: string | null; expires_at: string | null; created_at: string }>();

  // Nodes reachable via a root-level path are loaded by system://boot every
  // session — "never re-accessed" is expected for them, not a red flag.
  const bootLoaded = new Set(
    (active.results ?? [])
      .filter((r) => !r.path.includes("/"))
      .map((r) => r.node_uuid)
  );

  const now = nowSql();
  const staleCutoff = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 19).replace("T", " ");
  const stale: string[] = [];
  const expired: string[] = [];
  const unreadTop = new Set<string>();
  for (const r of active.results ?? []) {
    if (r.expires_at && r.expires_at < now) expired.push(`- ${makeUri(dom, r.path)}: ${r.title} (expired ${r.expires_at})`);
    if ((r.last_accessed_at === null || r.last_accessed_at < staleCutoff) && r.priority > 3) {
      stale.push(`- [p${r.priority}] ${makeUri(dom, r.path)}: ${r.title} (last seen ${r.last_accessed_at ?? "never"})`);
    }
    if ((r.last_accessed_at === null || r.last_accessed_at < staleCutoff) && r.priority <= 1 && !bootLoaded.has(r.node_uuid)) {
      unreadTop.add(`- [p${r.priority}] ${makeUri(dom, r.path)}: ${r.title}`);
    }
  }

  const orphanNodes = await db
    .prepare(
      `SELECT n.uuid FROM nodes n
       WHERE n.uuid != ? AND NOT EXISTS (SELECT 1 FROM paths p WHERE p.node_uuid = n.uuid)
       AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.parent_uuid = n.uuid OR e.child_uuid = n.uuid)`
    )
    .bind(ROOT_NODE)
    .all<{ uuid: string }>();
  const danglingTriggers = await db
    .prepare("SELECT COUNT(*) AS n FROM triggers t WHERE NOT EXISTS (SELECT 1 FROM nodes n WHERE n.uuid = t.node_uuid)")
    .first<{ n: number }>();
  const deprecatedVersions = await db.prepare("SELECT COUNT(*) AS n FROM memories WHERE deprecated = 1").first<{ n: number }>();

  const lines: string[] = [`# Diagnostic: ${dom}`, `generated: ${new Date().toISOString()}`, ""];
  lines.push(`Active memories: ${active.results?.length ?? 0}`);
  if (unreadTop.size) lines.push("", `## High-priority, never re-accessed (check disclosure/placement)`);
  for (const u of unreadTop) lines.push(u);
  if (expired.length) lines.push("", "## Expired (auto-forget will deprecate)");
  for (const e of expired) lines.push(e);
  if (stale.length) lines.push("", "## Stale (cold-forget candidates)");
  for (const s of stale) lines.push(s);
  lines.push("", "## Integrity");
  lines.push(`- orphan nodes: ${orphanNodes.results?.length ?? 0}`);
  lines.push(`- dangling trigger keywords: ${danglingTriggers?.n ?? 0}`);
  lines.push(`- deprecated versions (history): ${deprecatedVersions?.n ?? 0}`);
  if (!unreadTop.size && !expired.length && !stale.length && !(orphanNodes.results?.length)) {
    lines.push("", "No issues found.");
  }
  return lines.join("\n");
}

// ===========================================================================
// admin: browse / audit / status
// ===========================================================================

export interface MemoryEntry {
  uri: string;
  title: string;
  priority: number;
  updated_at: string;
}

export async function listAll(db: D1Database): Promise<MemoryEntry[]> {
  const rows = await db
    .prepare(
      `SELECT p.domain, p.path, e.name AS title, e.priority, e.created_at AS updated_at
       FROM paths p JOIN edges e ON e.id = p.edge_id
       ORDER BY e.priority ASC, e.created_at DESC`
    )
    .all<{ domain: string; path: string; title: string; priority: number; updated_at: string }>();
  return (rows.results ?? []).map((r) => ({
    uri: makeUri(r.domain, r.path),
    title: r.title,
    priority: r.priority,
    updated_at: r.updated_at,
  }));
}

export interface AuditEntry {
  id: number;
  op: string;
  uri: string | null;
  created_at: string;
  relation?: string | null;
}

export async function listAudit(db: D1Database, limit: number = 40, uri?: string): Promise<AuditEntry[]> {
  const n = Math.max(1, Math.min(limit, 200));
  const rows = uri
    ? await db
        .prepare("SELECT id, op, uri, relation, created_at FROM audit_logs WHERE uri = ? ORDER BY id DESC LIMIT ?")
        .bind(uri, n)
        .all<AuditEntry>()
    : await db.prepare("SELECT id, op, uri, relation, created_at FROM audit_logs ORDER BY id DESC LIMIT ?").bind(n).all<AuditEntry>();
  return rows.results ?? [];
}

export interface AuditDetail extends AuditEntry {
  before_json: string | null;
  after_json: string | null;
}

export async function getAudit(db: D1Database, id: number): Promise<AuditDetail | null> {
  return db
    .prepare("SELECT id, op, uri, before_json, after_json, created_at FROM audit_logs WHERE id = ?")
    .bind(id)
    .first<AuditDetail>();
}

export interface RollbackResult {
  ok: boolean;
  message: string;
}

// Rollback based on the audit row's before_json (state prior to the mutation).
//  create -> delete the uri (orphan-safe)
//  update -> restore previous content as a new memory version
//  delete -> re-insert node/memory/edge/path + search doc
//  alias  -> remove the alias path row
export async function rollbackMemory(db: D1Database, auditId: number): Promise<RollbackResult> {
  const a = await getAudit(db, auditId);
  if (!a) return { ok: false, message: "audit row not found" };

  switch (a.op) {
    case "create": {
      if (!a.uri) return { ok: false, message: "create rollback needs uri" };
      const r = await deleteMemory(db, a.uri);
      return { ok: r.deleted, message: r.deleted ? `rolled back create: ${a.uri}` : r.message };
    }
    case "update": {
      if (!a.uri) return { ok: false, message: "update rollback needs uri" };
      const before = a.before_json ? JSON.parse(a.before_json) : null;
      if (!before?.content) return { ok: false, message: "no prior content in audit" };
      const row = await resolvePathRow(db, parseUri(a.uri).domain, parseUri(a.uri).path);
      if (!row?.node_uuid) return { ok: false, message: "path gone" };
      const cur = await activeMemoryForNode(db, row.node_uuid);
      const now = nowSql();
      if (cur) {
        await db.prepare("UPDATE memories SET deprecated = 1, migrated_to = NULL WHERE id = ?").bind(cur.id).run();
      }
      const newId = await db
        .prepare("INSERT INTO memories (node_uuid, content, deprecated, migrated_to, created_at) VALUES (?, ?, 0, NULL, ?)")
        .bind(row.node_uuid, before.content, now)
        .run()
        .then((r) => Number(r.meta.last_row_id));
      if (cur) await db.prepare("UPDATE memories SET migrated_to = ? WHERE id = ?").bind(newId, cur.id).run();
      if (row.edge_id) {
        const edge = await db.prepare("SELECT priority, disclosure FROM edges WHERE id = ?").bind(row.edge_id).first<{ priority: number; disclosure: string | null }>();
        await upsertSearchDocument(db, parseUri(a.uri).domain, parseUri(a.uri).path, row.node_uuid, newId, before.content, edge?.disclosure ?? null, edge?.priority ?? 0);
      }
      await recordAudit(db, "update", a.uri, row.node_uuid, { memory_id: newId, content: before.content }, null);
      return { ok: true, message: `rolled back update: ${a.uri}` };
    }
    case "delete": {
      if (!a.uri || !a.before_json) return { ok: false, message: "delete rollback needs before state" };
      const b = JSON.parse(a.before_json);
      const { domain, path } = parseUri(a.uri);
      const nodeUuid = b.node_uuid;
      await db.prepare("INSERT OR IGNORE INTO nodes (uuid, created_at) VALUES (?, ?)").bind(nodeUuid, b.created_at ?? nowSql()).run();
      const memId = b.memory_id ?? null;
      if (memId) {
        await db
          .prepare("INSERT OR IGNORE INTO memories (id, node_uuid, content, deprecated, migrated_to, created_at) VALUES (?, ?, ?, 0, NULL, ?)")
          .bind(memId, nodeUuid, b.content ?? "", b.created_at ?? nowSql())
          .run();
      }
      // restore edge (if it was removed) and path
      const edgeId = b.edge_id ?? null;
      if (edgeId) {
        await db
          .prepare("INSERT OR IGNORE INTO edges (id, parent_uuid, child_uuid, name, priority, disclosure, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(edgeId, b.parent_uuid ?? ROOT_NODE, nodeUuid, b.name ?? path.split("/").pop() ?? path, b.priority ?? 0, b.disclosure ?? null, b.created_at ?? nowSql())
          .run();
      }
      await db
        .prepare("INSERT OR IGNORE INTO paths (domain, path, edge_id, node_uuid, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(domain, path, edgeId ?? b.edge_id ?? null, nodeUuid, nowSql())
        .run();
      await upsertSearchDocument(db, domain, path, nodeUuid, memId ?? 0, b.content ?? "", b.disclosure ?? null, b.priority ?? 0);
      await recordAudit(db, "delete", a.uri, nodeUuid, null, { restored: true });
      return { ok: true, message: `restored deleted memory: ${a.uri}` };
    }
    case "alias": {
      if (!a.uri) return { ok: false, message: "alias rollback needs uri" };
      const { domain, path } = parseUri(a.uri);
      const del = await db.prepare("DELETE FROM paths WHERE domain = ? AND path = ?").bind(domain, path).run();
      await removeSearchDocument(db, domain, path);
      return { ok: (del.meta.changes ?? 0) > 0, message: `removed alias: ${a.uri}` };
    }
    default:
      return { ok: false, message: `rollback not supported for op: ${a.op}` };
  }
}

export async function dbStatus(db: D1Database, snapshots: R2Bucket): Promise<Record<string, unknown>> {
  const counts = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM nodes) AS nodes,
        (SELECT COUNT(*) FROM memories) AS memories,
        (SELECT COUNT(*) FROM edges) AS edges,
        (SELECT COUNT(*) FROM paths) AS paths,
        (SELECT COUNT(*) FROM triggers) AS triggers,
        (SELECT COUNT(*) FROM audit_logs) AS audit,
        (SELECT COUNT(*) FROM search_fts) AS fts`
    )
    .first<Record<string, number>>();
  const snaps = await snapshots.list({ prefix: "snapshots/" });
  return {
    ...(counts ?? {}),
    snapshots: snaps.objects.length,
    last_snapshot: snaps.objects[0]?.key ?? null,
  };
}

// ===========================================================================
// browse: node detail + children + breadcrumbs (upstream REST contract)
// ===========================================================================

export interface BrowseNode {
  node: {
    path: string;
    domain: string;
    uri: string;
    name: string;
    content: string;
    priority: number;
    disclosure: string | null;
    created_at: string | null;
    is_virtual: boolean;
    aliases: string[];
    node_uuid: string;
    glossary_keywords: string[];
    glossary_matches: unknown[];
  };
  children: {
    domain: string;
    path: string;
    uri: string;
    name: string;
    priority: number;
    disclosure: string | null;
    content_snippet: string;
    approx_children_count: number;
  }[];
  breadcrumbs: { path: string; label: string }[];
}

export async function getNode(db: D1Database, domain: string, path: string, navOnly: boolean = false): Promise<BrowseNode> {
  const p = path.replace(/^\/+|\/+$/g, "");
  const segs = p ? p.split("/") : [];

  let nodeUuid: string;
  let memory: { content: string; priority: number; disclosure: string | null; created_at: string | null } | null = null;

  if (!p) {
    nodeUuid = ROOT_NODE;
    const rootPath = await resolvePathRow(db, domain, "");
    if (rootPath?.node_uuid) {
      const m = await activeMemoryForNode(db, rootPath.node_uuid);
      if (m) { memory = { content: m.content, priority: 0, disclosure: null, created_at: m.created_at }; nodeUuid = rootPath.node_uuid; }
    }
  } else {
    const row = await resolvePathRow(db, domain, p);
    if (!row?.node_uuid) throw new Error(`path not found: ${domain}://${p}`);
    nodeUuid = row.node_uuid;
    const m = await activeMemoryForNode(db, nodeUuid);
    if (m) memory = { content: m.content, priority: 0, disclosure: null, created_at: m.created_at };
  }

  // children via edges
  const childRows = await db
    .prepare(
      `SELECT e.child_uuid, e.name, e.priority, e.disclosure, p.domain, p.path, m.content
       FROM edges e
       LEFT JOIN paths p ON p.node_uuid = e.child_uuid AND p.domain = ? AND p.path != ''
       LEFT JOIN memories m ON m.node_uuid = e.child_uuid AND m.deprecated = 0
       WHERE e.parent_uuid = ?`
    )
    .bind(domain, nodeUuid)
    .all<{ child_uuid: string; name: string; priority: number; disclosure: string | null; domain: string; path: string; content: string }>();

  const seen = new Set<string>();
  const children = (childRows.results ?? [])
    .filter((c) => c.path && !seen.has(c.child_uuid) && seen.add(c.child_uuid))
    .map((c) => ({
      domain: c.domain || domain,
      path: c.path,
      uri: `${c.domain || domain}://${c.path}`,
      name: c.path.split("/").pop() || c.path,
      priority: c.priority ?? 0,
      disclosure: c.disclosure,
      content_snippet: (c.content || "").slice(0, 120),
      approx_children_count: 0,
    }))
    .sort((a, b) => (a.priority - b.priority) || a.path.localeCompare(b.path));

  // aliases: other paths to this node
  const aliasRows = await db
    .prepare("SELECT domain, path FROM paths WHERE node_uuid = ? AND NOT (domain = ? AND path = ?)")
    .bind(nodeUuid, domain, p)
    .all<{ domain: string; path: string }>();
  const aliases = (aliasRows.results ?? []).map((r) => `${r.domain}://${r.path}`);

  // breadcrumbs
  const breadcrumbs = [{ path: "", label: "root" }];
  let acc = "";
  for (const s of segs) { acc = acc ? `${acc}/${s}` : s; breadcrumbs.push({ path: acc, label: s }); }

  return {
    node: {
      path: p,
      domain,
      uri: `${domain}://${p}`,
      name: p.split("/").pop() || "root",
      content: memory?.content ?? "",
      priority: memory?.priority ?? 0,
      disclosure: memory?.disclosure ?? null,
      created_at: memory?.created_at ?? null,
      is_virtual: !memory,
      aliases,
      node_uuid: nodeUuid,
      glossary_keywords: [],
      glossary_matches: [],
    },
    children,
    breadcrumbs,
  };
}

async function upsertSearchDocument(
  db: D1Database,
  domain: string,
  path: string,
  nodeUuid: string,
  memoryId: number,
  content: string,
  disclosure: string | null,
  priority: number
): Promise<void> {
  const uri = makeUri(domain, path);
  await db
    .prepare(
      `INSERT INTO search_documents (domain, path, node_uuid, memory_id, uri, content, disclosure, priority, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(domain, path) DO UPDATE SET
         node_uuid = excluded.node_uuid, memory_id = excluded.memory_id, content = excluded.content,
         disclosure = excluded.disclosure, priority = excluded.priority, updated_at = excluded.updated_at`
    )
    .bind(domain, path, nodeUuid, memoryId, uri, content, disclosure, priority, nowSql())
    .run();
  // FTS is a standalone virtual table — replace, never accumulate.
  await db.prepare("DELETE FROM search_fts WHERE uri = ?").bind(uri).run();
  await db
    .prepare("INSERT INTO search_fts (uri, content, disclosure, search_terms) VALUES (?, ?, ?, ?)")
    .bind(uri, content, disclosure ?? "", priority.toString())
    .run();
}

/** Remove a document from both search tables (used on delete paths). */
async function removeSearchDocument(db: D1Database, domain: string, path: string, nodeUuid?: string): Promise<void> {
  await db.prepare("DELETE FROM search_documents WHERE domain = ? AND path = ?").bind(domain, path).run();
  const uri = makeUri(domain, path);
  await db.prepare("DELETE FROM search_fts WHERE uri = ?").bind(uri).run();
  if (nodeUuid) {
    await db.prepare("DELETE FROM search_documents WHERE node_uuid = ? AND domain = ? AND path != ?").bind(nodeUuid, domain, path).run();
  }
}

export async function syncSearchFromPaths(db: D1Database): Promise<void> {
  // rebuild FTS + search_documents from paths/edges/memories (post-migration)
  await db.exec("DELETE FROM search_fts");
  await db.exec("DELETE FROM search_documents");
  const rows = await db
    .prepare(
      `SELECT p.domain, p.path, p.node_uuid, m.id AS memory_id, m.content, e.priority, e.disclosure
       FROM paths p JOIN edges e ON e.id = p.edge_id JOIN memories m ON m.node_uuid = p.node_uuid AND m.deprecated = 0`
    )
    .all<{ domain: string; path: string; node_uuid: string; memory_id: number; content: string; priority: number; disclosure: string | null }>();
  for (const r of rows.results ?? []) {
    await upsertSearchDocument(db, r.domain, r.path, r.node_uuid, r.memory_id, r.content, r.disclosure, r.priority);
  }
  return;
}

export interface ForgetResult {
  deprecated_removed: number;
  orphans_removed: number;
}

/**
 * Automatic "dream" cleanup, run by the scheduled handler:
 *  1. Drop deprecated memory versions older than FORGET_DEPRECATED_DAYS (default 30).
 *     Old versions are superseded by newer content; audit_logs keep before/after
 *     snapshots so rollback still works after the row is gone.
 *  2. Drop nodes that lost every path reference AND have no children/edges left
 *     (true orphans: unreachable from the tree). Their audit trail remains.
 *  3. Rebuild search index afterwards (orphan rows may have been indexed).
 */
export interface ForgetResult {
  deprecated_removed: number;
  orphans_removed: number;
  expired_deprecated: number;
  cold_removed: number;
}

/**
 * Automatic "dream" cleanup, run by the scheduled handler:
 *  1. Drop deprecated memory versions older than FORGET_DEPRECATED_DAYS (default 30).
 *  2. Foresight: deprecate memories whose expires_at has passed (agent can still
 *     read history via audit, but they leave the searchable tree).
 *  3. Drop nodes that lost every path reference AND have no children/edges left
 *     (true orphans: unreachable from the tree). Their audit trail remains.
 *  4. Cold-forget: hard-delete low-level memories never accessed in 90 days
 *     (last_accessed_at null or old) — they are the "forgotten context".
 *     audit_logs keep before_json so rollback still works.
 *  5. Rebuild search index afterwards (orphan/expired rows may have been indexed).
 */
export async function autoForget(db: D1Database): Promise<ForgetResult> {
  const deprecatedDays = 30;
  const cutoff = new Date(Date.now() - deprecatedDays * 86400_000).toISOString().slice(0, 19).replace("T", " ");

  // 1. old deprecated versions (migrated_to IS NOT NULL keeps lineage visible; drop when old)
  const dep = await db
    .prepare("DELETE FROM memories WHERE deprecated = 1 AND created_at < ?")
    .bind(cutoff)
    .run();

  // 2. Foresight: content expired — deprecate so it leaves search but stays in audit history
  const now = nowSql();
  const expired = await db
    .prepare("UPDATE memories SET deprecated = 1 WHERE expires_at IS NOT NULL AND expires_at < ? AND deprecated = 0")
    .bind(now)
    .run();

  // 3. orphans: nodes with no path, no incoming/outgoing edges, not the root sentinel
  const orphans = await db
    .prepare(
      `SELECT n.uuid
       FROM nodes n
       WHERE n.uuid != ?
         AND NOT EXISTS (SELECT 1 FROM paths p WHERE p.node_uuid = n.uuid)
         AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.parent_uuid = n.uuid OR e.child_uuid = n.uuid)`
    )
    .bind(ROOT_NODE)
    .all<{ uuid: string }>();

  let orphanCount = 0;
  for (const o of orphans.results ?? []) {
    await db.prepare("DELETE FROM triggers WHERE node_uuid = ?").bind(o.uuid).run();
    await db.prepare("DELETE FROM memories WHERE node_uuid = ?").bind(o.uuid).run();
    await db.prepare("DELETE FROM nodes WHERE uuid = ?").bind(o.uuid).run();
    orphanCount++;
  }

  // 4. cold-forget: nodes whose memory was never accessed (90d) and low priority (>3)
  const coldCutoff = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 19).replace("T", " ");
  const cold = await db
    .prepare(
      `SELECT n.uuid, p.domain, p.path, m.id AS memory_id, m.content, e.priority
       FROM nodes n
       JOIN paths p ON p.node_uuid = n.uuid
       JOIN edges e ON e.id = p.edge_id
       JOIN memories m ON m.node_uuid = n.uuid AND m.deprecated = 0
       WHERE (n.last_accessed_at IS NULL OR n.last_accessed_at < ?)
         AND e.priority > 3
         AND p.path != ''
         AND NOT EXISTS (SELECT 1 FROM triggers t WHERE t.node_uuid = n.uuid)
       LIMIT 50`
    )
    .bind(coldCutoff)
    .all<{ uuid: string; domain: string; path: string; memory_id: number; content: string; priority: number }>();

  let coldCount = 0;
  for (const c of cold.results ?? []) {
    const uri = makeUri(c.domain, c.path);
    const before = { node_uuid: c.uuid, memory_id: c.memory_id, content: c.content, path: c.path };
    await db.prepare("DELETE FROM paths WHERE domain = ? AND path = ?").bind(c.domain, c.path).run();
    const nodeRefs = await db
      .prepare("SELECT (SELECT COUNT(*) FROM paths WHERE node_uuid = ?) + (SELECT COUNT(*) FROM edges WHERE parent_uuid = ? OR child_uuid = ?) AS n")
      .bind(c.uuid, c.uuid, c.uuid)
      .first<{ n: number }>();
    if ((nodeRefs?.n ?? 0) === 0) {
      await db.prepare("DELETE FROM memories WHERE node_uuid = ?").bind(c.uuid).run();
      await db.prepare("DELETE FROM nodes WHERE uuid = ?").bind(c.uuid).run();
    }
    await recordAudit(db, "delete", uri, c.uuid, before, null, "cold-forget");
    coldCount++;
  }

  // 5. search index may reference dropped/expired content
  if (orphanCount > 0 || coldCount > 0) {
    await syncSearchFromPaths(db);
  }

  return {
    deprecated_removed: dep.meta.changes ?? 0,
    orphans_removed: orphanCount,
    expired_deprecated: expired.meta.changes ?? 0,
    cold_removed: coldCount,
  };
}
