import { Env } from "./config";

const ACCESS_EMAIL_HEADER = "Cf-Access-Authenticated-User-Email";

function unauthorized(req: Request): Response {
  const url = new URL(req.url);
  const hasAuthHeader = !!req.headers.get("Authorization");
  console.warn(JSON.stringify({ event: "auth_denied", path: url.pathname, method: req.method, hasAuthHeader }));
  return new Response(JSON.stringify({ detail: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Two-mode auth:
 *  - /mcp           : Bearer token only (agent clients)
 *  - /admin/* /api/*: CF Access verified (Cf-Access-Authenticated-User-Email present)
 *                     OR Bearer token — dual mode, zero config.
 */
export function checkAuth(req: Request, env: Env): Response | null {
  const url = new URL(req.url);
  const auth = req.headers.get("Authorization") || "";
  const bearerOk = auth === `Bearer ${env.API_TOKEN}`;

  if (url.pathname === "/mcp") {
    return bearerOk ? null : unauthorized(req);
  }

  if (url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/")) {
    // CF Access validated (any Access JWT assertion proves the edge let it through)
    if (req.headers.get("Cf-Access-Jwt-Assertion") || req.headers.get(ACCESS_EMAIL_HEADER)) return null;
    return bearerOk ? null : unauthorized(req);
  }

  return null;
}
