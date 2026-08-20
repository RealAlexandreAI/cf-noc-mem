import { Env } from "./config";
import { searchMemory, type SearchHit } from "./db";

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

export interface VectorHit {
  uri: string;
  score: number;
  priority: number;
  snippet: string;
}

/** Normalize Workers AI embedding output ({shape, data:[{embedding}]} or {result:[...]}). */
function embeddingsOf(res: unknown): number[][] {
  const r = res as { data?: { embedding?: number[] }[]; result?: { embedding?: number[] }[] };
  const list = r.data ?? r.result ?? [];
  return list.map((d) => d.embedding ?? []);
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

/** Embed a memory (title + content) and upsert its vector. Never throws. */
export async function upsertMemoryVector(
  env: Env,
  uri: string,
  title: string | null,
  content: string,
  priority: number,
): Promise<void> {
  if (!env.VECTORIZE) return;
  try {
    const text = `${title ?? ""}\n${content}`.slice(0, MAX_TEXT_CHARS);
    const [vector] = await embedTexts(env, [text]);
    if (!vector?.length) return;
    await upsertVectors(env, [
      {
        id: uri,
        values: vector,
        metadata: { uri, title: title ?? "", snippet: content.slice(0, SNIPPET_LEN), priority },
      },
    ]);
  }
  catch {
    // tolerate: memory write succeeded, semantic recall just lags
  }
}

/** Remove a memory's vector. Never throws. */
export async function deleteMemoryVector(env: Env, uri: string): Promise<void> {
  if (!env.VECTORIZE) return;
  try {
    await env.VECTORIZE.deleteByIds([uri]);
  }
  catch {
    // tolerate
  }
}

/** Cosine/similarity search over the memory index. */
export async function semanticSearch(env: Env, query: string, limit: number): Promise<VectorHit[]> {
  if (!env.VECTORIZE) return [];
  const [vector] = await embedTexts(env, [query]);
  if (!vector?.length) return [];
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
