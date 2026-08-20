import { Env } from "./config";

const ACCESS_EMAIL_HEADER = "Cf-Access-Authenticated-User-Email";

function unauthorized(): Response {
  return new Response(JSON.stringify({ detail: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Two-mode auth:
 *  - /mcp           : Bearer token only (agent clients)
 *  - /admin/*       : CF Access verified (Cf-Access-Authenticated-User-Email present)
 *                     OR Bearer token — dual mode, zero config.
 *                    Personal users protect /admin/* with Cloudflare Access in Zero Trust;
 *                    open-source users without Access fall back to the Bearer token.
 */
export function checkAuth(req: Request, env: Env): Response | null {
  const url = new URL(req.url);
  const auth = req.headers.get("Authorization") || "";
  const bearerOk = auth === `Bearer ${env.API_TOKEN}`;

  if (url.pathname === "/mcp") {
    return bearerOk ? null : unauthorized();
  }

  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
    if (req.headers.get(ACCESS_EMAIL_HEADER)) return null; // CF Access already validated
    return bearerOk ? null : unauthorized();
  }

  return null;
}
