import { Env } from "./config";
import { searchMemory, readMemory, listAll, type SearchHit } from "./db";

/**
 * Semantic memory search via Workers AI embeddings (bge-m3, multilingual /
 * CJK-capable) + Vectorize. Pure keyword FTS misses memories that are
 * semantically related but share no tokens ("部署失败" vs "发布 pipeline 挂了");
 * this layer adds vector recall and merges it with the existing FTS.
 *
 * Design rules:
 * - Vectorize is OPTIONAL (Env.VECTORIZE?). Every call degrades gracefully
 *   to FTS-only when the binding is missing or any step fails — memory
 *   writes must never break because embedding failed.
 * - Vector id = memory URI (stable, unique). upsert overwrites on update.
 */

const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const SNIPPET_LEN = 200;
const MAX_TEXT_CHARS = 8000;

/**
 * Vectorize ids are capped at 64 bytes; long noc:// URIs (deep paths) can
 * exceed that. Hash the URI to a fixed 40-char SHA-1 hex id; the original
 * URI is kept in metadata for display/dedup.
 */
async function vectorId(uri: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(uri));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface VectorHit {
  uri: string;
  score: number;
  priority: number;
  snippet: string;
}

/**
 * Normalize Workers AI embedding output. bge-m3 returns
 * { meta: {...}, data: [[...], [...]] } (2D array of vectors); other models
 * may return { data: [{ embedding: [...] }] }. Handle both.
 */
function embeddingsOf(res: unknown): number[][] {
  const r = res as { data?: unknown; result?: unknown };
  const data = r.data ?? r.result;
  if (!Array.isArray(data) || data.length === 0) return [];
  if (Array.isArray(data[0])) return data as number[][];
  return (data as { embedding?: number[] }[]).map((d) => d.embedding ?? []);
}

async function embedTexts(env: Env, texts: string[]): Promise<number[][]> {
  if (!env.AI) return [];
  const res = await env.AI.run(EMBEDDING_MODEL, { text: texts });
  return embeddingsOf(res);
}

async function upsertVectors(env: Env, vectors: { id: string; values: number[]; metadata: Record<string, string | number> }[]): Promise<void> {
  if (!env.VECTORIZE || vectors.length === 0) return;
  await env.VECTORIZE.upsert(vectors);
}

/**
 * Embed a memory (title + content) and upsert its vector. Never throws;
 * returns whether the vector was actually written and the failure reason
 * (false when Vectorize is unbound or any step failed — memory writes must
 * never break on this).
 */
export async function upsertMemoryVector(
  env: Env,
  uri: string,
  title: string | null,
  content: string,
  priority: number,
): Promise<{ ok: boolean; err?: string }> {
  if (!env.VECTORIZE) return { ok: false, err: "no_vectorize" };
  try {
    const text = `${title ?? ""}\n${content}`.slice(0, MAX_TEXT_CHARS);
    const [vector] = await embedTexts(env, [text]);
    if (!vector?.length) {
      console.warn(JSON.stringify({ event: "embed_empty", uri, model: EMBEDDING_MODEL }));
      return { ok: false, err: "embed_empty" };
    }
    await upsertVectors(env, [
      {
        id: await vectorId(uri),
        values: vector,
        metadata: { uri, title: title ?? "", snippet: content.slice(0, SNIPPET_LEN), priority },
      },
    ]);
    return { ok: true };
  }
  catch (e) {
    // tolerate: memory write succeeded, semantic recall just lags
    console.warn(JSON.stringify({ event: "vector_upsert_failed", uri, err: String(e) }));
    return { ok: false, err: String(e).slice(0, 160) };
  }
}

/**
 * Backfill vectors for every existing memory (e.g. after enabling Vectorize
 * or embedding model changes). Returns write stats plus per-uri failure
 * reasons; single-entry failures never abort the pass.
 */
export async function reindexAllVectors(env: Env): Promise<{ total: number; ok: number; failed: { uri: string; err: string }[] }> {
  if (!env.VECTORIZE) return { total: 0, ok: 0, failed: [] };
  const entries = await listAll(env.DB);
  let ok = 0;
  const failed: { uri: string; err: string }[] = [];
  const writtenUris: string[] = [];
  for (const e of entries) {
    try {
      const mem = await readMemory(env.DB, e.uri);
      if (!mem) continue;
      const r = await upsertMemoryVector(env, e.uri, e.title, mem.content, e.priority);
      if (r.ok) {
        ok++;
        writtenUris.push(e.uri);
      }
      else failed.push({ uri: e.uri, err: r.err ?? "unknown" });
    }
    catch (err) {
      // readMemory failure for a single entry must not abort the pass
      failed.push({ uri: e.uri, err: String(err).slice(0, 160) });
    }
  }
  // Drop legacy vectors keyed by the raw URI (pre-hash ids); new ids are
  // sha1(uri) so this only removes duplicates, never freshly-written rows.
  try {
    if (writtenUris.length) await env.VECTORIZE.deleteByIds(writtenUris);
  }
  catch {
    // tolerate
  }
  return { total: entries.length, ok, failed };
}

/** Remove a memory's vector. Never throws. */
export async function deleteMemoryVector(env: Env, uri: string): Promise<void> {
  if (!env.VECTORIZE) return;
  try {
    await env.VECTORIZE.deleteByIds([await vectorId(uri)]);
  }
  catch {
    // tolerate
  }
}

/** Cosine/similarity search over the memory index. */
export async function semanticSearch(env: Env, query: string, limit: number): Promise<VectorHit[]> {
  if (!env.VECTORIZE) return [];
  const [vector] = await embedTexts(env, [query]);
  if (!vector?.length) {
    console.warn(JSON.stringify({ event: "query_embed_empty", query: query.slice(0, 60) }));
    return [];
  }
  const res = await env.VECTORIZE.query(vector, { topK: limit, returnMetadata: "all" });
  return (res.matches ?? []).map((m) => ({
    uri: (m.metadata?.uri as string) ?? m.id,
    score: m.score,
    priority: Number(m.metadata?.priority ?? 0),
    snippet: (m.metadata?.snippet as string) ?? "",
  }));
}

/**
 * Hybrid search: semantic hits first (dedup by uri), then FTS fills the
 * rest. Falls back to FTS-only when Vectorize is unconfigured or fails.
 */
export async function hybridSearch(env: Env, query: string, limit: number): Promise<SearchHit[]> {
  const fts = await searchMemory(env.DB, query, limit);
  let semantic: VectorHit[] = [];
  if (env.VECTORIZE) {
    try {
      semantic = await semanticSearch(env, query, limit);
    }
    catch {
      semantic = [];
    }
  }
  if (semantic.length === 0) return fts;

  const seen = new Set<string>();
  const merged: SearchHit[] = [];
  for (const s of semantic) {
    if (seen.has(s.uri)) continue;
    seen.add(s.uri);
    merged.push({
      uri: s.uri,
      node_uuid: "",
      memory_id: 0,
      priority: s.priority,
      snippet: s.snippet || "(semantic match)",
    });
  }
  for (const f of fts) {
    if (seen.has(f.uri)) continue;
    seen.add(f.uri);
    merged.push(f);
  }
  return merged.slice(0, limit);
}
