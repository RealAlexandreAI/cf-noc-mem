import { Env } from "./config";

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
 * Edge-trust auth. Cloudflare Access guards the whole site:
 *  - humans (dashboard, /admin, /api) → email OTP
 *  - machines (/mcp) → service token (CF-Access-Client-Id/Secret)
 * Every request reaching the worker has already passed edge verification, so
 * presence of an injected Access header is sufficient. /health and /assets/*
 * are exempt at the edge (bypass app for /health; static assets ride the
 * session cookie) and stay open here.
 */
export function checkAuth(req: Request, _env: Env): Response | null {
  const url = new URL(req.url);
  const isProtected =
    url.pathname === "/mcp" ||
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/api/");
  if (!isProtected) return null;

  const assertion = req.headers.get("Cf-Access-Jwt-Assertion");
  const email = req.headers.get("Cf-Access-Authenticated-User-Email");
  if (assertion || email) return null;

  return unauthorized(req);
}
