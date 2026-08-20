import { Env } from "./config";

const MCP_PATHS = new Set(["/mcp"]);

export function checkAuth(req: Request, env: Env): Response | null {
  const url = new URL(req.url);
  if (!MCP_PATHS.has(url.pathname)) return null;

  const auth = req.headers.get("Authorization") || "";
  if (auth === `Bearer ${env.API_TOKEN}`) return null;

  return new Response(JSON.stringify({ detail: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
