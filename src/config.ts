export interface Env {
  DB: D1Database;
  SNAPSHOTS: R2Bucket;
  API_TOKEN: string;
  MCP_MAX_CONTENT_BYTES?: string;
}

export function maxContentBytes(env: Env): number {
  const n = parseInt(env.MCP_MAX_CONTENT_BYTES || "65536", 10);
  return Number.isFinite(n) ? n : 65536;
}
