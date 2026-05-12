"""
Settings API — read and update server configuration from the admin UI.
"""

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import config
from db.namespace import get_namespace

_IN_DOCKER = Path("/.dockerenv").exists()

router = APIRouter(prefix="/settings", tags=["settings"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class SettingsUpdate(BaseModel):
    database_url: str | None = None
    valid_domains: list[str] | None = None
    host: str | None = None
    web_port: int | None = None
    auto_open_browser: bool | None = None
    api_token: str | None = None
    cors_origins: str | None = None
    public_readonly_mcp: bool | None = None


class BootUriUpdate(BaseModel):
    uris: list[str]


class DatabaseCreate(BaseModel):
    path: str


class DatabaseTest(BaseModel):
    database_url: str


# ---------------------------------------------------------------------------
# Settings CRUD
# ---------------------------------------------------------------------------

@router.get("")
async def get_settings():
    """Return all current settings from config.json."""
    result = {
        "settings": config.get_all(),
        "config_path": str(config.CONFIG_PATH),
    }
    if _IN_DOCKER:
        result["locked_fields"] = ["web_port", "host"]
    return result


_URI_RE = re.compile(r"^[a-zA-Z0-9_-]+://[a-zA-Z0-9_/\.-]*$")
_DEFAULT_NS_SENTINEL = "_ns_default_0x7f3a9e"


@router.put("")
async def update_settings(body: SettingsUpdate):
    """Update one or more settings in config.json."""
    updated = []
    needs_restart = False

    fields = body.model_dump(exclude_none=True)

    _DOCKER_LOCKED = {"web_port", "host"}
    if _IN_DOCKER:
        locked = _DOCKER_LOCKED & fields.keys()
        if locked:
            raise HTTPException(
                status_code=422,
                detail=f"Cannot change {', '.join(sorted(locked))} in Docker — these are managed by docker-compose.yml and nginx.conf.",
            )

    if "web_port" in fields:
        port = fields["web_port"]
        if not (1 <= port <= 65535):
            raise HTTPException(status_code=422, detail=f"Invalid port {port}. Must be between 1 and 65535.")

    if "api_token" in fields:
        token = fields["api_token"]
        if token and len(token) < 32:
            raise HTTPException(
                status_code=422,
                detail=f"api_token is too short ({len(token)} chars). Use at least 32 characters, or omit to keep the existing token.",
            )

    pending_host = fields.get("host", config.get("host"))
    pending_token = fields.get("api_token", config.get("api_token"))
    if pending_host not in ("127.0.0.1", "localhost", "::1") and not pending_token:
        raise HTTPException(
            status_code=422,
            detail="API token is required when host is network-reachable. Set an API token (min 32 chars) or keep host as 127.0.0.1.",
        )

    for field_name, value in fields.items():
        config.set_value(field_name, value)
        updated.append(field_name)
        if field_name in ("database_url", "host", "web_port", "api_token", "valid_domains", "public_readonly_mcp", "cors_origins"):
            needs_restart = True

    return {
        "success": True,
        "updated": updated,
        "needs_restart": needs_restart,
    }


# ---------------------------------------------------------------------------
# Boot URI management (replaces browse.py boot-uris endpoints)
# ---------------------------------------------------------------------------

@router.get("/boot-uris")
async def get_boot_uris():
    """Return boot URIs for the current namespace."""
    ns = get_namespace()
    return {"uris": config.get_boot_uris(ns)}


@router.put("/boot-uris")
async def set_boot_uris(body: BootUriUpdate):
    """Replace the full boot URI list (supports reorder)."""
    ns = get_namespace()

    for uri in body.uris:
        if not _URI_RE.match(uri):
            raise HTTPException(status_code=422, detail=f"Invalid URI format: {uri}")

    config.set_boot_uris(body.uris, ns)
    return {"success": True, "uris": body.uris}


class BootUriToggle(BaseModel):
    uri: str
    enabled: bool


@router.patch("/boot-uris")
async def toggle_boot_uri(body: BootUriToggle):
    """Add or remove a single URI from the boot list."""
    ns = get_namespace()
    current = config.get_boot_uris(ns)
    uri = body.uri.strip()
    if not uri:
        raise HTTPException(status_code=422, detail="URI cannot be empty")
    if not _URI_RE.match(uri):
        raise HTTPException(status_code=422, detail="Invalid URI format")

    if body.enabled:
        if uri not in current:
            current.append(uri)
    else:
        current = [u for u in current if u != uri]

    config.set_boot_uris(current, ns)
    return {"success": True, "uris": current}


# --- Multi-namespace boot URI management (used by Settings drawer) ---


def _resolve_ns(namespace: str) -> str:
    """Map the URL-safe sentinel back to the real empty-string key."""
    return "" if namespace == _DEFAULT_NS_SENTINEL else namespace


@router.get("/boot-uris/all")
async def get_all_boot_uris():
    """Return boot URIs for every namespace at once."""
    return {"boot_uris": config.get_all_boot_uris()}


@router.put("/boot-uris/ns/{namespace}")
async def set_boot_uris_for_ns(namespace: str, body: BootUriUpdate):
    """Set boot URIs for a specific namespace. Use '_default' for the default."""
    ns = _resolve_ns(namespace)
    for uri in body.uris:
        if not _URI_RE.match(uri):
            raise HTTPException(status_code=422, detail=f"Invalid URI format: {uri}")
    config.set_boot_uris(body.uris, ns)
    return {"success": True, "namespace": ns, "uris": body.uris}


@router.delete("/boot-uris/ns/{namespace}")
async def delete_boot_uris_for_ns(namespace: str):
    """Remove a namespace override so it falls back to default."""
    ns = _resolve_ns(namespace)
    if ns == "":
        raise HTTPException(status_code=400, detail="Cannot delete the default namespace")
    if not config.delete_boot_uris(ns):
        raise HTTPException(status_code=404, detail=f"No boot URI override for namespace '{ns}'")
    return {"success": True, "namespace": namespace}


# ---------------------------------------------------------------------------
# Database management
# ---------------------------------------------------------------------------

@router.get("/database/status")
async def database_status():
    """Return current DB info: type, path (SQLite), size, etc."""
    url = config.get("database_url") or ""
    info: dict = {"database_url": url, "type": "unknown"}

    if not url:
        return info

    if "sqlite" in url:
        info["type"] = "sqlite"
        match = re.search(r"///(.+)$", url)
        if match:
            db_path = Path(match.group(1))
            info["path"] = str(db_path)
            info["exists"] = db_path.exists()
            if db_path.exists():
                size = db_path.stat().st_size
                info["size_bytes"] = size
                info["size_display"] = _format_size(size)
    elif "postgresql" in url:
        info["type"] = "postgresql"
        info["url_masked"] = _mask_password(url)

    return info


_ALLOWED_DB_SCHEMES = ("sqlite+aiosqlite", "postgresql+asyncpg")


@router.post("/database/test")
async def test_database(body: DatabaseTest):
    """Test if a database URL is connectable."""
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    url = body.database_url
    if not any(url.startswith(s + "://") for s in _ALLOWED_DB_SCHEMES):
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported scheme. Allowed: {', '.join(_ALLOWED_DB_SCHEMES)}",
        )

    try:
        engine = create_async_engine(url, echo=False)
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        await engine.dispose()
        return {"success": True, "message": "Connection successful"}
    except Exception as e:
        return {"success": False, "message": str(e)}


@router.post("/database/create")
async def create_database(body: DatabaseCreate):
    """Create a new empty SQLite database at the given path."""
    db_path = Path(body.path).resolve()

    if db_path.exists():
        raise HTTPException(status_code=409, detail="File already exists")

    db_path.parent.mkdir(parents=True, exist_ok=True)

    url = f"sqlite+aiosqlite:///{db_path.as_posix()}"
    try:
        from db.database import DatabaseManager
        mgr = DatabaseManager(url)
        await mgr.init_db()
        await mgr.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create database: {e}")

    return {
        "success": True,
        "database_url": url,
        "path": str(db_path),
    }


@router.post("/database/open-folder")
async def open_database_folder():
    """Open the current SQLite DB's containing folder in the OS file manager."""
    import os
    import platform
    import subprocess

    if Path("/.dockerenv").exists():
        raise HTTPException(
            status_code=501,
            detail="Open folder is not available in Docker deployments. Access the file via the mounted volume on the host.",
        )

    url = config.get("database_url") or ""
    if "sqlite" not in url:
        raise HTTPException(status_code=400, detail="Only available for SQLite databases")

    match = re.search(r"///(.+)$", url)
    if not match:
        raise HTTPException(status_code=400, detail="Could not parse database path from URL")

    db_path = Path(match.group(1)).resolve()
    folder = db_path.parent if db_path.is_file() else db_path

    if not folder.exists():
        raise HTTPException(status_code=404, detail=f"Folder does not exist: {folder}")

    system = platform.system()
    if system == "Windows":
        os.startfile(str(folder))
    elif system == "Darwin":
        subprocess.Popen(["open", str(folder)])
    else:
        subprocess.Popen(["xdg-open", str(folder)])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_size(size_bytes: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def _mask_password(url: str) -> str:
    return re.sub(r"://([^:]+):([^@]+)@", r"://\1:****@", url)
