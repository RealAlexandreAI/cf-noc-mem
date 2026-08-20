export interface Env {
  DB: D1Database;
  SNAPSHOTS: R2Bucket;
  ASSETS: Fetcher;
  API_TOKEN: string;
  MCP_MAX_CONTENT_BYTES?: string;
  /** Workers AI binding (required for semantic search embeddings). */
  AI: Ai;
  /** Optional Vectorize index — when absent, search degrades to FTS-only. */
  VECTORIZE?: VectorizeIndex;
}

export function maxContentBytes(env: Env): number {
  const n = parseInt(env.MCP_MAX_CONTENT_BYTES || "65536", 10);
  return Number.isFinite(n) ? n : 65536;
}
