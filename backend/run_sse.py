import os
import sys
import uvicorn

# Ensure we can import from backend dir
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from auth import BearerTokenAuthMiddleware
from mcp_server import mcp


def main():
    """
    Run the Nocturne Memory MCP server using SSE (Server-Sent Events) transport.
    This is required for clients that don't support stdio (like some web-based tools).
    """
    print("Initializing Nocturne Memory SSE Server...")

    # Create the Starlette app for SSE
    # The default mount path is usually /sse or /
    # mcp.sse_app() creates an app that serves /sse and /messages
    # Create the Starlette app for SSE
    # Use "/" as mount path to get flat routing:
    # - SSE endpoint: /sse
    # - POST endpoint: /messages/
    # This ensures compatibility with all MCP clients (OpenCode, Claude Desktop, etc.)
    sse_asgi_app = mcp.sse_app("/")
    app = BearerTokenAuthMiddleware(sse_asgi_app, excluded_paths=[])

    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")

    print(f"Starting SSE Server on http://{host}:{port}")
    print(f"SSE Endpoint: http://{host}:{port}/sse")

    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
