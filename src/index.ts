import { checkAuth } from "./auth";
import { Env } from "./config";
import { handleMcpRequest } from "./mcp";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health" && req.method === "GET") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "content-type": "application/json" },
      });
    }

    const denied = checkAuth(req, env);
    if (denied) return denied;

    if (url.pathname === "/mcp" && req.method === "POST") {
      const ct = req.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        return new Response(JSON.stringify({ error: "content-type must be application/json" }), {
          status: 415,
          headers: { "content-type": "application/json" },
        });
      }
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: "invalid JSON body" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return handleMcpRequest(body, env);
    }

    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  },
};
