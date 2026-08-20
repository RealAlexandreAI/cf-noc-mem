import { Env } from "./config";

const PROTECTED_PATHS = ["/mcp", "/admin"];

export function checkAuth(req: Request, env: Env): Response | null {
  const url = new URL(req.url);
  if (!PROTECTED_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"))) return null;

  const auth = req.headers.get("Authorization") || "";
  if (auth === `Bearer ${env.API_TOKEN}`) return null;

  return new Response(JSON.stringify({ detail: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
