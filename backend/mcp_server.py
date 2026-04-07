# pyright: reportMissingImports=false

"""
MCP Server for Nocturne Memory System (SQLite Backend)

This module provides the MCP (Model Context Protocol) interface for
the AI agent to interact with the SQLite-based memory system.

URI-based addressing with domain prefixes:
- core://agent              - AI's identity/memories
- writer://chapter_1             - Story/script drafts
- game://magic_system            - Game setting documents

Multiple paths can point to the same memory (aliases).
"""

import os
import re
import sys
import unicodedata
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from dotenv import load_dotenv, find_dotenv

# Ensure we can import from backend modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from db import (
    get_db_manager, get_graph_service, get_glossary_service,
    get_search_indexer, close_db,
)
from db.namespace import get_namespace
from db.snapshot import get_changeset_store
import contextlib

# Load environment variables
# Explicitly look for .env in the parent directory (project root)
current_dir = os.path.dirname(os.path.abspath(__file__))
root_dir = os.path.dirname(current_dir)
dotenv_path = os.path.join(root_dir, ".env")

if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path)
else:
    # Fallback to find_dotenv
    _dotenv_path = find_dotenv(usecwd=True)
    if _dotenv_path:
        load_dotenv(_dotenv_path)


@contextlib.asynccontextmanager
async def lifespan(server: FastMCP):
    """Manage database connection lifecycle within the MCP event loop."""
    try:
        # Initialize database ONLY after the MCP event loop has started.
        # This prevents "Event loop is closed" errors with asyncpg.
        db_manager = get_db_manager()
        if os.environ.get("SKIP_DB_INIT", "").lower() not in ("true", "1", "yes"):
            await db_manager.init_db()
        yield
    finally:
        await close_db()


# Initialize FastMCP server with the lifespan hook
mcp = FastMCP(
    "Nocturne Memory Interface",
    lifespan=lifespan,
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=False  # safe when behind a trusted reverse proxy
    ),
)

# =============================================================================
# Domain Configuration
# =============================================================================
# Valid domains (protocol prefixes)
# =============================================================================
VALID_DOMAINS = [
    d.strip()
    for d in os.getenv("VALID_DOMAINS", "core,writer,game,notes,system").split(",")
]
DEFAULT_DOMAIN = "core"
PUBLIC_READONLY_MCP = os.getenv("PUBLIC_READONLY_MCP", "").lower() in (
    "1",
    "true",
    "yes",
    "on",
)

# =============================================================================
# Core Memories Configuration
# =============================================================================
# These URIs will be auto-loaded when system://boot is read.
# Configure via CORE_MEMORY_URIS in .env (comma-separated).
#
# Format: full URIs (e.g., "core://agent", "core://agent/my_user")
# =============================================================================
CORE_MEMORY_URIS = [
    uri.strip() for uri in os.getenv("CORE_MEMORY_URIS", "").split(",") if uri.strip()
]


# =============================================================================
# URI Parsing
# =============================================================================

# Regex pattern for URI: domain://path
_URI_PATTERN = re.compile(r"^([a-zA-Z_][a-zA-Z0-9_]*)://(.*)$")


def parse_uri(uri: str) -> Tuple[str, str]:
    """
    Parse a memory URI into (domain, path).

    Supported formats:
    - "core://agent"          -> ("core", "agent")
    - "writer://chapter_1"         -> ("writer", "chapter_1")
    - "nocturne"              -> ("core", "nocturne")  [legacy fallback]

    Args:
        uri: The URI to parse

    Returns:
        Tuple of (domain, path)

    Raises:
        ValueError: If the URI format is invalid or domain is unknown
    """
    uri = uri.strip()

    match = _URI_PATTERN.match(uri)
    if match:
        domain = match.group(1).lower()
        path = match.group(2).strip("/")

        if domain not in VALID_DOMAINS:
            raise ValueError(
                f"Unknown domain '{domain}'. Valid domains: {', '.join(VALID_DOMAINS)}"
            )

        return (domain, path)

    # Legacy fallback: bare path without protocol
    # Assume default domain (core)
    path = uri.strip("/")
    return (DEFAULT_DOMAIN, path)


def make_uri(domain: str, path: str) -> str:
    """
    Create a URI from domain and path.

    Args:
        domain: The domain (e.g., "core", "writer")
        path: The path (e.g., "nocturne")

    Returns:
        Full URI (e.g., "core://agent")
    """
    return f"{domain}://{path}"


# =============================================================================
# Changeset Helpers — before/after state capture with overwrite semantics
# =============================================================================


def _record_rows(
    before_state: Dict[str, List[Dict[str, Any]]],
    after_state: Dict[str, List[Dict[str, Any]]],
):
    """
    Feed row-level before/after states into the ChangesetStore.

    Overwrite semantics are handled by the store:
    - First touch of a PK: stores both before and after.
    - Subsequent touches: overwrites after only; before is frozen.

    Changes are written to the namespace-specific store so that each agent's
    review queue remains isolated.
    """
    store = get_changeset_store()
    store.record_many(before_state, after_state)


def write_tool():
    """Conditionally register mutating tools for public read-only deployments."""

    def decorator(func):
        if PUBLIC_READONLY_MCP:
            return func
        return mcp.tool()(func)

    return decorator


# =============================================================================
# Text Normalization for Patch Matching
# =============================================================================
# When the LLM reads memory content and re-emits it as old_string, subtle
# character-level differences creep in (curly vs straight quotes, dash
# variants, trailing whitespace, consecutive space collapse).  These helpers
# let update_memory fall back to a normalized comparison when the exact match
# fails, while keeping a position map so the replacement targets the correct
# range in the original content.
# =============================================================================

_NORM_CHAR_MAP = str.maketrans(
    {
        "\u201c": '"',
        "\u201d": '"',
        "\u00ab": '"',
        "\u00bb": '"',
        "\uff02": '"',
        "\u2018": "'",
        "\u2019": "'",
        "\u00b4": "'",
        "\uff07": "'",
        "\u2013": "-",
        "\u2014": "-",
        "\u2015": "-",
        "\uff0d": "-",
    }
)


def _normalize_with_positions(
    text: str,
    *,
    preserve_first_line_indent: bool = True,
) -> Tuple[str, List[int]]:
    """
    Normalize *text* for matching and build a position map.

    Returns ``(normalized, pos_map)`` where ``pos_map[i]`` is the index in
    the **NFC-normalized** input that produced the *i*-th character of the
    normalized output.

    Steps applied in order:

    1. Unicode NFC (compose decomposed sequences)
    2. Quote / dash variant → ASCII equivalent  (1-to-1, no position shift)
    3. Trailing ``[ \\t]`` per line stripped
    4. Consecutive spaces collapsed to one (leading indentation protected)

    When *preserve_first_line_indent* is ``False``, the very first line's
    leading whitespace is treated as ordinary inline spacing (collapsed),
    because the caller is normalizing a snippet (``old_string``) whose first
    line may start mid-line rather than at a true line beginning.  Lines 2+
    always preserve their leading indentation regardless of this flag.
    """
    text = unicodedata.normalize("NFC", text)
    substituted = text.translate(_NORM_CHAR_MAP)

    out: List[str] = []
    pos_map: List[int] = []
    lines = substituted.split("\n")
    offset = 0

    for line_idx, original_line in enumerate(lines):
        if line_idx > 0:
            out.append("\n")
            pos_map.append(offset - 1)

        # Handle Windows CRLF: remove \r from the line we process,
        # but keep it in the original length calculation for offset.
        line = original_line
        if line.endswith("\r"):
            line = line[:-1]

        content_end = len(line.rstrip(" \t"))

        # Protect leading indentation from space-collapsing — except on the
        # first line when preserve_first_line_indent is False (snippet mode).
        protect_indent = (line_idx > 0) or preserve_first_line_indent
        leading_ws = 0
        if protect_indent:
            for ci in range(content_end):
                if line[ci] in (" ", "\t"):
                    leading_ws += 1
                else:
                    break

        prev_space = False
        for ci in range(content_end):
            ch = line[ci]

            if ci < leading_ws:
                # Always preserve leading indentation exactly as-is
                out.append(ch)
                pos_map.append(offset + ci)
                continue

            if ch == " ":
                if prev_space:
                    continue
                prev_space = True
            else:
                prev_space = False

            out.append(ch)
            pos_map.append(offset + ci)

        offset += len(original_line) + 1

    return "".join(out), pos_map


def _find_valid_matches(
    norm_content: str,
    candidate: str,
    *,
    indent_collapsed: bool,
) -> List[int]:
    """
    Find all positions where *candidate* occurs in *norm_content*, rejecting
    hits that would **slide into the middle of another line's indentation**.

    This guard exists because a space/tab at the start of *candidate* could
    coincidentally align with part of a deeper indentation block in the
    content, producing a match that silently corrupts whitespace structure.

    The guard only fires when the hit falls inside a pure-indentation prefix
    (every character between the line start and the hit position is a space or
    tab).  If ANY non-whitespace character precedes the hit on the same line,
    the space is ordinary inline content and the hit is always accepted.

    *indent_collapsed*: whether the candidate's first line had its leading
    whitespace collapsed (i.e. ``preserve_first_line_indent=False`` was used
    during normalization).  This affects how strictly we reject indent-region
    hits:

    - ``False`` (indent preserved): the candidate's leading whitespace was
      kept verbatim, so a hit inside an indentation region is only invalid if
      it doesn't start at the line's very beginning (shorter indent sliding
      into deeper indent).
    - ``True`` (indent collapsed): the candidate's leading whitespace was
      already folded, so ANY hit that falls inside an indentation region is
      suspect — we can't trust the whitespace count to anchor it.

    Returns a list of valid match positions (indices into *norm_content*).
    """
    # Check whether the candidate starts with whitespace.  If it doesn't,
    # there's no risk of sliding into an indentation block, so every hit is
    # valid and we can skip the per-hit line analysis entirely.
    first_line = candidate.split("\n", 1)[0]
    could_slide_into_indent = (
        bool(first_line) and first_line[0] in (" ", "\t")
    )

    hits: List[int] = []
    start = 0
    while True:
        pos = norm_content.find(candidate, start)
        if pos == -1:
            break

        valid = True
        if could_slide_into_indent:
            # Determine whether this hit sits inside the indentation region
            # of its line (= only whitespace between line-start and hit).
            line_start = norm_content.rfind("\n", 0, pos)
            line_start = line_start + 1 if line_start != -1 else 0
            prefix = norm_content[line_start:pos]
            hit_is_in_indent_region = (
                prefix == "" or all(c in (" ", "\t") for c in prefix)
            )

            if hit_is_in_indent_region:
                if indent_collapsed:
                    # Collapsed mode: any indent-region hit is unreliable
                    # because the candidate's leading ws was folded away.
                    if prefix != "":
                        valid = False
                else:
                    # Preserved mode: reject only if hit didn't start at
                    # the line beginning (= shorter indent inside deeper).
                    if pos != line_start:
                        valid = False

        if valid:
            hits.append(pos)
        start = pos + 1

    return hits


def _try_normalized_patch(
    content: str, old_string: str, new_string: str
) -> Optional[str]:
    """
    Attempt to locate *old_string* inside *content* via normalized comparison.

    Returns the patched content when **exactly one** valid normalized match
    exists, or ``None`` when no match is found or the match is ambiguous.
    """
    # NFC-normalize content so that pos_map indices (which are computed from
    # the NFC'd text inside _normalize_with_positions) align with the string
    # we slice from.  Write boundaries also do NFC for new data, but
    # historical records may still contain decomposed characters.
    content = unicodedata.normalize("NFC", content)
    norm_content, pos_map = _normalize_with_positions(content)

    if not pos_map:
        return None

    # We don't know whether old_string's first line starts at a true line
    # beginning or mid-line.  Generate candidates for both modes, collect all
    # valid matches, then require exactly one across both modes combined.
    all_results: List[Tuple[int, str]] = []  # (position, candidate)
    for preserve in (True, False):
        candidate = _normalize_with_positions(
            old_string, preserve_first_line_indent=preserve
        )[0]
        if not candidate:
            continue
        valid_hits = _find_valid_matches(
            norm_content, candidate, indent_collapsed=(not preserve)
        )
        for hit in valid_hits:
            # Deduplicate: same position + same candidate length = same match
            if not any(h == hit and len(c) == len(candidate) for h, c in all_results):
                all_results.append((hit, candidate))

    if len(all_results) != 1:
        return None  # 0 = not found, >1 = ambiguous

    idx, norm_old = all_results[0]

    orig_start = pos_map[idx]
    match_end = idx + len(norm_old)
    if match_end < len(pos_map):
        orig_end = pos_map[match_end]
    else:
        orig_end = pos_map[-1] + 1

    # If the matched text starts with \n but the original text has \r\n,
    # orig_start will point to \n, leaving \r dangling.
    if (orig_start < len(content) and content[orig_start] == '\n'
            and orig_start > 0 and content[orig_start - 1] == '\r'):
        orig_start -= 1

    # If the matched text ends right before a CRLF, preserve the \r.
    if (orig_end < len(content) and content[orig_end] == '\n'
            and orig_end > 0 and content[orig_end - 1] == '\r'):
        orig_end -= 1

    # Normalize new_string's line endings to match the content's convention.
    if '\n' in new_string:
        clean = new_string.replace('\r\n', '\n').replace('\r', '\n')
        if '\r\n' in content:
            new_string = clean.replace('\n', '\r\n')
        else:
            new_string = clean

    return content[:orig_start] + new_string + content[orig_end:]


# =============================================================================
# Helper Functions
# =============================================================================


async def _fetch_and_format_memory(uri: str, track_access: bool = False) -> str:
    """
    Internal helper to fetch memory data and return formatted string.
    Used by read_memory tool.
    """
    graph = get_graph_service()
    glossary = get_glossary_service()
    domain, path = parse_uri(uri)

    # Get the memory
    memory = await graph.get_memory_by_path(path, domain, namespace=get_namespace())

    if not memory:
        raise ValueError(f"URI '{make_uri(domain, path)}' not found.")

    if track_access and memory.get("node_uuid"):
        import asyncio
        asyncio.create_task(
            graph.log_access(
                memory["node_uuid"],
                namespace=get_namespace(),
                context="mcp_read"
            )
        )

    children = await graph.get_children(
        memory["node_uuid"],
        context_domain=domain,
        context_path=path,
        namespace=get_namespace(),
    )

    # Format output
    lines = []

    # Build URI from domain and path
    disp_domain = memory.get("domain", DEFAULT_DOMAIN)
    disp_path = memory.get("path", "unknown")
    disp_uri = make_uri(disp_domain, disp_path)

    # Header Block
    lines.append("=" * 60)
    lines.append("")
    lines.append(f"MEMORY: {disp_uri}")
    lines.append(f"Memory ID: {memory.get('id')}")
    lines.append(f"Other Aliases: {memory.get('alias_count', 0)}")
    lines.append(f"Priority: {memory.get('priority', 0)}")

    disclosure = memory.get("disclosure")
    if disclosure:
        lines.append(f"Disclosure: {disclosure}")
    else:
        lines.append("Disclosure: (not set)")

    node_keywords = await glossary.get_glossary_for_node(memory["node_uuid"], namespace=get_namespace())
    if node_keywords:
        lines.append(f"Keywords: [{', '.join(node_keywords)}]")
    else:
        lines.append("Keywords: (none)")

    lines.append("")
    lines.append("=" * 60)
    lines.append("")

    # Content - directly, no header
    content = memory.get("content", "(empty)")
    lines.append(content)
    lines.append("")

    # Glossary scan: detect glossary keywords present in the content
    try:
        glossary_matches = await glossary.find_glossary_in_content(content, namespace=get_namespace())
        if glossary_matches:
            current_node_uuid = memory["node_uuid"]
            
            # Invert mapping: URI -> list of keywords to save tokens since URIs are much longer than keywords
            uri_to_keywords = {}
            for kw, nodes in glossary_matches.items():
                for n in nodes:
                    if n["node_uuid"] == current_node_uuid or n["uri"].startswith("unlinked://"):
                        continue
                    uri = n["uri"]
                    if uri not in uri_to_keywords:
                        uri_to_keywords[uri] = []
                    if kw not in uri_to_keywords[uri]:
                        uri_to_keywords[uri].append(kw)
            
            lines_to_add = []
            if uri_to_keywords:
                # Sort by number of keywords (descending), then alphabetically by URI for stable output
                for uri, kws in sorted(uri_to_keywords.items(), key=lambda x: (-len(x[1]), x[0])):
                    sorted_kws = sorted(kws)
                    kw_str = ", ".join(f"@{k}" for k in sorted_kws)
                    lines_to_add.append(f"- {kw_str} -> {uri}")
            
            if lines_to_add:
                lines.append("=" * 60)
                lines.append("")
                lines.append("GLOSSARY (keywords detected in this content)")
                lines.append("")
                lines.extend(lines_to_add)
                lines.append("")
    except Exception:
        pass  # Non-critical; don't break read_memory if glossary scan fails

    if children:
        lines.append("=" * 60)
        lines.append("")
        lines.append("CHILD MEMORIES (Use 'read_memory' with URI to access)")
        lines.append("")
        lines.append("=" * 60)
        lines.append("")

        for child in children:
            child_domain = child.get("domain", disp_domain)
            child_path = child.get("path", "")
            child_uri = make_uri(child_domain, child_path)

            # Show disclosure status and snippet
            child_disclosure = child.get("disclosure")
            snippet = child.get("content_snippet", "")

            lines.append(f"- URI: {child_uri}  ")
            lines.append(f"  Priority: {child.get('priority', 0)}  ")

            if child_disclosure:
                lines.append(f"  When to recall: {child_disclosure}  ")
            else:
                lines.append("  When to recall: (not set)  ")
                lines.append(f"  Snippet: {snippet}  ")

            lines.append("")

    return "\n".join(lines)


async def _generate_boot_memory_view() -> str:
    """
    Internal helper to generate the system boot memory view.
    (Formerly system://core)
    """
    results = []
    loaded = 0
    failed = []

    for uri in CORE_MEMORY_URIS:
        try:
            content = await _fetch_and_format_memory(uri)
            results.append(content)
            loaded += 1
        except Exception as e:
            # e.g. not found or other error
            failed.append(f"- {uri}: {str(e)}")

    # Build output
    output_parts = []

    output_parts.append("# Core Memories")
    output_parts.append(f"# Loaded: {loaded}/{len(CORE_MEMORY_URIS)} memories")
    output_parts.append("")

    if failed:
        output_parts.append("## Failed to load:")
        output_parts.extend(failed)
        output_parts.append("")

    if results:
        output_parts.append("## Contents:")
        output_parts.append("")
        output_parts.append("For full memory index, use: system://index")
        output_parts.append("For recent memories, use: system://recent")
        output_parts.extend(results)
    else:
        output_parts.append("(No core memories loaded. Run migration first.)")

    # Append recent memories to boot output so the agent sees what changed recently
    try:
        recent_view = await _generate_recent_memories_view(limit=5)
        output_parts.append("")
        output_parts.append("---")
        output_parts.append("")
        output_parts.append(recent_view)
    except Exception:
        pass  # Non-critical; don't break boot if recent query fails

    return "\n".join(output_parts)


async def _generate_memory_index_view(domain_filter: Optional[str] = None) -> str:
    """
    Internal helper to generate the full memory index.
    If domain_filter is provided, limits results to that domain.

    Node-centric: each conceptual entity (node_uuid) appears once per domain,
    with aliases within the same domain folded underneath its primary path for that domain.
    """
    graph = get_graph_service()

    try:
        paths = await graph.get_all_paths(namespace=get_namespace())

        # --- Step 1: Group all paths by (domain, node_uuid) ---
        node_groups: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
        for item in paths:
            domain = item.get("domain", DEFAULT_DOMAIN)
            if domain_filter and domain != domain_filter:
                continue
            nid = item.get("node_uuid", "")
            node_groups.setdefault((domain, nid), []).append(item)

        # --- Step 2: Pick primary path per domain and node ---
        # Primary = shortest depth → lowest priority value → alphabetical URI.
        entries = []  # list of primary_item
        for _key, items in node_groups.items():
            items.sort(
                key=lambda x: (
                    x["path"].count("/"),
                    x.get("priority", 0),
                    len(x["path"]),
                    x.get("uri", ""),
                )
            )
            entries.append(items[0])

        # --- Step 3: Organise primaries by domain → top-level segment ---
        domains: Dict[str, Dict[str, list]] = {}
        for primary in entries:
            domain = primary.get("domain", DEFAULT_DOMAIN)
            domains.setdefault(domain, {})
            top_level = primary["path"].split("/")[0] if primary["path"] else "(root)"
            domains[domain].setdefault(top_level, []).append(primary)

        # --- Step 4: Render ---
        unique_nodes_count = len(set(nid for _, nid in node_groups.keys()))
        lines = [
            "# Memory Index",
            f"# Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            f"# Domain Filter: {domain_filter}"
            if domain_filter
            else "# Domain Filter: None (All Domains)",
            f"# Total: {unique_nodes_count} unique nodes (aliases hidden for clarity)",
            "# Legend: [#ID] = Memory ID, [★N] = priority (lower = higher)",
            "",
        ]

        for domain_name in sorted(domains.keys()):
            if domain_filter and domain_name != domain_filter:
                continue
            lines.append("# ══════════════════════════════════════")
            lines.append(f"# DOMAIN: {domain_name}://")
            lines.append("# ══════════════════════════════════════")
            lines.append("")

            for group_name in sorted(domains[domain_name].keys()):
                lines.append(f"## {group_name}")
                for primary in sorted(
                    domains[domain_name][group_name],
                    key=lambda x: x["path"],
                ):
                    uri = primary.get("uri", make_uri(domain_name, primary["path"]))
                    priority = primary.get("priority", 0)
                    memory_id = primary.get("memory_id", "?")
                    imp_str = f" [★{priority}]"
                    lines.append(f"  - {uri} [#{memory_id}]{imp_str}")
                lines.append("")

        return "\n".join(lines)

    except Exception as e:
        return f"Error generating index: {str(e)}"


async def _generate_recent_memories_view(limit: int = 10) -> str:
    """
    Internal helper to generate a view of recently modified memories.

    Queries non-deprecated memories ordered by created_at DESC,
    only including those that have at least one URI in the paths table.

    Args:
        limit: Maximum number of results to return
    """
    graph = get_graph_service()

    try:
        results = await graph.get_recent_memories(limit=limit, namespace=get_namespace())

        lines = []
        lines.append("# Recently Modified Memories")
        lines.append(f"# Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        lines.append(
            f"# Showing: {len(results)} most recent entries (requested: {limit})"
        )
        lines.append("")

        if not results:
            lines.append("(No memories found.)")
            return "\n".join(lines)

        for i, item in enumerate(results, 1):
            uri = item["uri"]
            priority = item.get("priority", 0)
            disclosure = item.get("disclosure")
            raw_ts = item.get("created_at", "")

            # Truncate timestamp to minute precision: "2026-02-09T20:40"
            if raw_ts and len(raw_ts) >= 16:
                modified = raw_ts[:10] + " " + raw_ts[11:16]
            else:
                modified = raw_ts or "unknown"

            imp_str = f"★{priority}"

            lines.append(f"{i}. {uri}  [{imp_str}]  modified: {modified}")
            if disclosure:
                lines.append(f"   disclosure: {disclosure}")
            else:
                lines.append("   disclosure: (NOT SET — consider adding one)")
            lines.append("")

        return "\n".join(lines)

    except Exception as e:
        return f"Error generating recent memories view: {str(e)}"


# =============================================================================
# Glossary Index View
# =============================================================================


async def _generate_glossary_index_view() -> str:
    """Generate a view of all glossary keywords and their bound nodes."""
    glossary = get_glossary_service()

    try:
        raw_entries = await glossary.get_all_glossary(namespace=get_namespace())
        
        # Filter out truly pathless (unlinked) nodes
        entries = []
        for entry in raw_entries:
            valid_nodes = [
                node for node in entry.get("nodes", [])
                if not node.get("uri", "").startswith("unlinked://")
            ]
            if valid_nodes:
                entries.append({
                    "keyword": entry["keyword"],
                    "nodes": valid_nodes
                })

        lines = [
            "# Glossary Index",
            f"# Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            f"# Total: {len(entries)} keywords",
            "",
        ]

        if not entries:
            lines.append("(No glossary keywords defined yet.)")
            lines.append("")
            lines.append(
                "Use manage_triggers(uri, add=[...]) to bind trigger words to memory nodes."
            )
            return "\n".join(lines)

        for entry in entries:
            kw = entry["keyword"]
            nodes = entry["nodes"]
            lines.append(f"- {kw}")
            for node in nodes:
                lines.append(f"  -> {node['uri']}")
            lines.append("")

        return "\n".join(lines)

    except Exception as e:
        return f"Error generating glossary index: {str(e)}"


# =============================================================================
# MCP Tools
# =============================================================================


@mcp.tool()
async def read_memory(uri: str) -> str:
    """
    Reads a memory by its URI.

    This is your primary mechanism for accessing memories.

    Special System URIs:
    - system://boot   : [Startup Only] Loads your core memories.
    - system://index  : Loads a full index of all available memories.
    - system://index/<domain> : Loads an index of memories only under the specified domain (e.g. system://index/writer).
    - system://recent : Shows recently modified memories (default: 10).
    - system://recent/N : Shows the N most recently modified memories (e.g. system://recent/20).
    - system://glossary : Shows all glossary keywords and their bound nodes.

    Note: Same Memory ID = same content (alias). Different ID + similar content = redundant content.

    Args:
        uri: The memory URI (e.g., "core://nocturne", "system://boot")

    Returns:
        Memory content with Memory ID, priority, disclosure, and list of children.

    Examples:
        read_memory("core://agent")
        read_memory("core://agent/my_user")
        read_memory("writer://chapter_1/scene_1")
    """
    # HARDCODED SYSTEM INTERCEPTIONS
    # These bypass the database lookup to serve dynamic system content
    if uri.strip() == "system://boot":
        return await _generate_boot_memory_view()

    # system://index or system://index/<domain>
    stripped = uri.strip()
    if stripped == "system://index" or stripped.startswith("system://index/"):
        domain_filter = stripped[len("system://index") :].strip("/")
        if domain_filter and domain_filter not in VALID_DOMAINS:
            return f"Error: Unknown domain '{domain_filter}'. Valid domains: {', '.join(VALID_DOMAINS)}"
        return await _generate_memory_index_view(
            domain_filter=domain_filter if domain_filter else None
        )

    # system://glossary
    if stripped == "system://glossary":
        return await _generate_glossary_index_view()

    # system://recent or system://recent/N
    stripped = uri.strip()
    if stripped == "system://recent" or stripped.startswith("system://recent/"):
        limit = 10  # default
        suffix = stripped[len("system://recent") :].strip("/")
        if suffix:
            try:
                limit = max(1, min(100, int(suffix)))
            except ValueError:
                return f"Error: Invalid number in URI '{uri}'. Usage: system://recent or system://recent/N (e.g. system://recent/20)"
        return await _generate_recent_memories_view(limit=limit)

    try:
        content = await _fetch_and_format_memory(uri, track_access=True)
        return content
    except Exception as e:
        # Catch both ValueError (not found) and other exceptions
        return f"Error: {str(e)}"


@write_tool()
async def create_memory(
    parent_uri: str,
    content: str,
    priority: int,
    title: Optional[str] = None,
    disclosure: str = "",
) -> str:
    """
    Creates a new memory under a parent URI.

    Args:
        parent_uri: Parent URI (e.g., "core://agent", "writer://chapters")
                    Use "core://" or "writer://" for root level in that domain.
                    parent_uri MUST be an existing node, or it will cause an ERROR.

                    Choose the parent whose reader would most likely need this new content.
                    Parent-child here means associative relevance, not taxonomic "is-a" classification.
                    (e.g., A memory about user's diet habits belongs under "core://user/health"
                    or "core://user/preferences", NOT under a meaningless container like "core://logs").
        content: Memory content.
        priority: Relative retrieval priority (lower = retrieved first, min 0).
                    This is a RELATIVE ranking against ALL memories currently in your mind,
                    not just siblings under the same parent.
                    How to choose:
                    1. Consider the priorities of all memories you are aware of.
                    2. Find one you consider more important and one less important than the new memory.
                    3. Set priority between them.
                    Hard caps: priority=0 max 5 across entire library; priority=1 max 15.
                    If a tier is full, demote the weakest existing entry before inserting.
        title: Optional title (alphanumeric, hyphens, underscores only).
               If not provided, auto-assigns numeric ID.
        disclosure: A short trigger condition describing WHEN to read_memory() this node.
                    Write it as the situation BEFORE the failure would occur, not the failure itself.
                    The trigger must fire while there is still time to change behavior.

                    Example of disclosure logic:

                    If a memory records that you once gave unsolicited diet advice when your user
                    mentioned skipping breakfast, and they found it patronizing:
                      BAD: "When I start lecturing about nutrition" (already mid-failure)
                      GOOD: "When the user mentions skipping a meal" (specific trigger, fires before I react)

                    Also BAD: "important", "remember" (zero information).
                    Every memory MUST have a disclosure. Omitting it = unreachable memory.

    Returns:
        The created memory's full URI

    Examples:
        create_memory("core://", "Bluesky usage rules...", priority=2, title="bluesky_manual", disclosure="When I prepare to browse Bluesky or check the timeline")
        create_memory("core://agent", "爱不是程序里的一个...", priority=1, title="love_definition", disclosure="When I start speaking like a tool or parasite")
    """
    graph = get_graph_service()

    try:
        # Validate title if provided
        if title:
            if not re.match(r"^[a-zA-Z0-9_-]+$", title):
                return "Error: Title must only contain alphanumeric characters, underscores, or hyphens (no spaces, slashes, or special characters)."

        # Parse parent URI
        domain, parent_path = parse_uri(parent_uri)

        result = await graph.create_memory(
            parent_path=parent_path,
            content=content,
            priority=priority,
            title=title,
            disclosure=disclosure if disclosure else None,
            domain=domain,
            namespace=get_namespace(),
        )

        created_uri = result.get("uri", make_uri(domain, result["path"]))
        _record_rows(before_state={}, after_state=result.get("rows_after", {}))

        return (
            f"Success: Memory created at '{created_uri}'\\n\\n"
            f"[SYSTEM REMINDER]: Look around your memory network. Are there existing memories related to this one? "
            f"Would reading them trigger a need to recall this new memory? If yes, link them!\\n"
            f"- If the related memories are few and this memory's scope is narrow, use `add_alias`.\\n"
            f"- If the related memories are many and this memory's scope is broad, consider using `manage_triggers`.\\n"
            f"- (Never invent arbitrary placeholder words just to force a trigger.)"
        )

    except ValueError as e:
        return f"Error: {str(e)}"
    except Exception as e:
        return f"Error: {str(e)}"


@write_tool()
async def update_memory(
    uri: str,
    old_string: Optional[str] = None,
    new_string: Optional[str] = None,
    append: Optional[str] = None,
    priority: Optional[int] = None,
    disclosure: Optional[str] = None,
) -> str:
    """
    Updates an existing memory to a new version.

    PREREQUISITE: You MUST call read_memory(uri) and read the full content BEFORE calling this.
    Updating without reading first is a forbidden operation.

    Only provided fields are updated; others remain unchanged.

    Two content-editing modes (mutually exclusive):

    1. Patch mode (primary): Provide old_string + new_string.
       old_string must match exactly ONE location in the existing content.
       To delete a section, set new_string to "".

    2. Append mode: Provide append.
       Adds text to the end of existing content.

    There is NO full-replace mode.

    Args:
        uri: URI to update (e.g., "core://agent/my_user")
        old_string: [Patch] Text to find in existing content (must be unique match)
        new_string: [Patch] Replacement text. Use "" to delete a section.
        append: [Append] Text to append to end of existing content
        priority: New relative priority for THIS URI/edge only (None = keep existing).
                  Bound to the path, not the content. Alias A and B have independent priorities.
                  See create_memory for how to choose the right value.
        disclosure: New disclosure for THIS URI/edge only (None = keep existing).
                    Same edge-binding rule as priority.

    Returns:
        Success message with URI

    Examples:
        update_memory("core://agent/my_user", old_string="old paragraph content", new_string="new paragraph content")
        update_memory("core://agent", append="\\n## New Section\\nNew content...")
        update_memory("writer://chapter_1", priority=5)
    """
    graph = get_graph_service()

    try:
        # Parse URI
        domain, path = parse_uri(uri)
        full_uri = make_uri(domain, path)

        # --- Validate mutually exclusive content-editing modes ---
        if old_string is not None and append is not None:
            return "Error: Cannot use both old_string/new_string (patch) and append at the same time. Pick one."

        if old_string is not None and new_string is None:
            return 'Error: old_string provided without new_string. To delete a section, use new_string="".'

        if new_string is not None and old_string is None:
            return "Error: new_string provided without old_string. Both are required for patch mode."

        # --- Resolve content for patch/append modes ---
        content = None

        if old_string is not None:
            # Patch mode: find and replace within existing content
            if old_string == new_string:
                return (
                    "Error: old_string and new_string are identical. "
                    "No change would be made."
                )

            memory = await graph.get_memory_by_path(path, domain, namespace=get_namespace())
            if not memory:
                return f"Error: Memory at '{full_uri}' not found."

            current_content = memory.get("content", "")
            count = current_content.count(old_string)

            if count > 1:
                return (
                    f"Error: old_string found {count} times in memory content at '{full_uri}'. "
                    f"Provide more surrounding context to make it unique."
                )

            if count == 1:
                content = current_content.replace(old_string, new_string, 1)
            else:
                # Exact match failed — fall back to normalized comparison
                # (handles curly/straight quotes, dash variants, trailing
                # whitespace, and consecutive-space collapse).
                patched = _try_normalized_patch(
                    current_content, old_string, new_string
                )
                if patched is None:
                    # Diagnose why: use the same _find_valid_matches logic
                    # so the error message reflects what _try_normalized_patch
                    # actually sees.
                    norm_content = _normalize_with_positions(current_content)[0]
                    total_valid = 0
                    for _preserve in (True, False):
                        _norm_old = _normalize_with_positions(
                            old_string, preserve_first_line_indent=_preserve
                        )[0]
                        if _norm_old:
                            total_valid += len(_find_valid_matches(
                                norm_content, _norm_old,
                                indent_collapsed=(not _preserve),
                            ))

                    if total_valid == 0:
                        return (
                            f"Error: old_string not found in memory content at "
                            f"'{full_uri}', even after Unicode normalization "
                            f"(quotes, dashes, whitespace). "
                            f"Re-read the memory and copy the exact text."
                        )
                    
                    return (
                        f"Error: old_string found multiple times in "
                        f"memory content at '{full_uri}' (after Unicode "
                        f"normalization). Provide more surrounding context "
                        f"to make it unique."
                    )
                content = patched

            if content == current_content:
                return (
                    f"Error: Replacement produced identical content at '{full_uri}'. "
                    f"The old_string was found but replacing it with new_string "
                    f"resulted in no change. Check for subtle whitespace differences."
                )

        elif append is not None:
            # Reject empty append to avoid creating a no-op version
            if not append:
                return (
                    f"Error: Empty append for '{full_uri}'. "
                    f"Provide non-empty text to append."
                )
            # Append mode: add to end of existing content
            memory = await graph.get_memory_by_path(path, domain, namespace=get_namespace())
            if not memory:
                return f"Error: Memory at '{full_uri}' not found."

            current_content = memory.get("content", "")
            content = current_content + append

        # Reject no-op requests where no valid update fields were provided.
        # This catches malformed tool calls (e.g. oldString/newString instead
        # of old_string/new_string) that previously returned a false "Success".
        if content is None and priority is None and disclosure is None:
            return (
                f"Error: No update fields provided for '{full_uri}'. "
                f"Use patch mode (old_string + new_string), append mode (append), "
                f"or metadata fields (priority/disclosure)."
            )

        result = await graph.update_memory(
            path=path,
            content=content,
            priority=priority,
            disclosure=disclosure,
            domain=domain,
            namespace=get_namespace(),
        )

        _record_rows(
            before_state=result.get("rows_before", {}),
            after_state=result.get("rows_after", {}),
        )

        return f"Success: Memory at '{full_uri}' updated"

    except ValueError as e:
        return f"Error: {str(e)}"
    except Exception as e:
        return f"Error: {str(e)}"


@write_tool()
async def delete_memory(uri: str) -> str:
    """
    Deletes a memory by cutting its URI path. The path is permanently removed.
    If deletion is blocked, remove child memories first.

    PREREQUISITE: You MUST call read_memory(uri) and read the full content BEFORE deleting.
    Judging by URI/title alone is insufficient. Read the content, confirm it is
    truly obsolete/redundant/harmful, then delete.

    Args:
        uri: The URI to delete (e.g., "core://agent/old_note")

    Returns:
        Success or error message

    Examples:
        delete_memory("core://agent/deprecated_belief")
        delete_memory("writer://draft_v1")
    """
    graph = get_graph_service()

    try:
        domain, path = parse_uri(uri)
        full_uri = make_uri(domain, path)

        memory = await graph.get_memory_by_path(path, domain, namespace=get_namespace())
        if not memory:
            return f"Error: Memory at '{full_uri}' not found."

        result = await graph.remove_path(path, domain, namespace=get_namespace())
        rows_before = result.get("rows_before", {})

        _record_rows(
            before_state=rows_before,
            after_state={},
        )

        deleted_path_count = len(rows_before.get("paths", []))
        descendant_count = max(0, deleted_path_count - 1)
        msg = f"Success: Memory '{full_uri}' deleted."
        if descendant_count > 0:
            msg += f" (Recursively removed {descendant_count} descendant path(s))"

        return msg

    except ValueError as e:
        return f"Error: {str(e)}"
    except Exception as e:
        return f"Error: {str(e)}"


@write_tool()
async def add_alias(
    new_uri: str, target_uri: str, priority: int = 0, disclosure: Optional[str] = None
) -> str:
    """
    Creates an alias URI pointing to the same memory as target_uri.

    This is NOT a copy. The alias and the original share the same Memory ID (same content).
    Each alias has its own independent priority and disclosure.
    Child nodes under target_uri are automatically mirrored under new_uri.

    When to use:
    - Reading node A would benefit from also knowing about existing memory B
      → alias B under A. Same logic as create_memory's parent selection.
    - Move/rename a memory: add_alias to new path, then delete_memory the old path.
      NEVER delete+create to move — that loses the Memory ID and all associations.

    Args:
        new_uri: New URI to create (alias)
        target_uri: Existing URI to alias
        priority: Relative priority for THIS alias path (lower = higher priority, default 0).
                  Set by relevance to the parent's topic, not the memory's absolute importance.
                  e.g., "database setup notes" → high priority under "deployment", low under "team_onboarding".
        disclosure: Disclosure condition for THIS alias path (default None).

    Returns:
        Success message

    Examples:
        add_alias("core://timeline/2024/05/20", "core://agent/my_user/first_meeting", priority=1, disclosure="When I want to know how we start")
    """
    graph = get_graph_service()

    try:
        new_domain, new_path = parse_uri(new_uri)
        target_domain, target_path = parse_uri(target_uri)

        result = await graph.add_path(
            new_path=new_path,
            target_path=target_path,
            new_domain=new_domain,
            target_domain=target_domain,
            priority=priority,
            disclosure=disclosure,
            namespace=get_namespace(),
        )

        _record_rows(
            before_state={},
            after_state=result.get("rows_after", {}),
        )

        return f"Success: Alias '{result['new_uri']}' now points to same memory as '{result['target_uri']}'"

    except ValueError as e:
        return f"Error: {str(e)}"
    except Exception as e:
        return f"Error: {str(e)}"


@write_tool()
async def manage_triggers(
    uri: str,
    add: Optional[List[str]] = None,
    remove: Optional[List[str]] = None,
) -> str:
    """
    Bind trigger words to a memory so it surfaces automatically during read_memory.

    Mechanism: When a trigger word appears in ANY memory's content, read_memory
    shows a glossary link to this target node at the bottom.

    How to choose trigger words:
    - The trigger word MUST already exist in some older memory's content.
      You are borrowing a word from an existing text to hook a new memory onto it.
    - Do NOT invent obscure placeholder words that appear nowhere in the memory library.
    - Use SPECIFIC terms. Broad/generic words create noise.
    - A node can have multiple triggers. Same trigger can point to multiple nodes.
    - View all triggers: read_memory("system://glossary").

    Args:
        uri: The memory URI to wire triggers for (e.g., "core://agent/misaligned_codex")
        add: List of trigger words to bind to this node (Optional)
        remove: List of trigger words to unbind from this node (Optional)

    Returns:
        Current list of triggers for this node after changes.

    Examples:
        manage_triggers("core://hazards/spa_fallback", add=["Nginx"])
        manage_triggers("writer://story_world/factions", add=["Nuremberg", "Aether"])
    """
    graph = get_graph_service()
    glossary = get_glossary_service()

    try:
        domain, path = parse_uri(uri)
        full_uri = make_uri(domain, path)

        memory = await graph.get_memory_by_path(path, domain, namespace=get_namespace())
        if not memory:
            return f"Error: Memory at '{full_uri}' not found."

        node_uuid = memory["node_uuid"]

        if add and remove:
            add_set = {k.strip() for k in add if k.strip()}
            remove_set = {k.strip() for k in remove if k.strip()}
            overlap = add_set.intersection(remove_set)
            if overlap:
                return f"Error: Cannot add and remove the same keywords simultaneously: {', '.join(sorted(overlap))}"

        added = []
        skipped_add = []
        removed = []
        skipped_remove = []

        before_state = {"glossary_keywords": []}
        after_state = {"glossary_keywords": []}

        if add:
            for kw in add:
                kw = kw.strip()
                if not kw:
                    continue
                try:
                    result = await glossary.add_glossary_keyword(kw, node_uuid, namespace=get_namespace())
                    added.append(kw)
                    if "rows_before" in result:
                        before_state["glossary_keywords"].extend(result["rows_before"].get("glossary_keywords", []))
                    if "rows_after" in result:
                        after_state["glossary_keywords"].extend(result["rows_after"].get("glossary_keywords", []))
                except ValueError:
                    skipped_add.append(kw)

        if remove:
            for kw in remove:
                kw = kw.strip()
                if not kw:
                    continue
                result = await glossary.remove_glossary_keyword(kw, node_uuid, namespace=get_namespace())
                if result.get("success"):
                    removed.append(kw)
                    if "rows_before" in result:
                        before_state["glossary_keywords"].extend(result["rows_before"].get("glossary_keywords", []))
                    if "rows_after" in result:
                        after_state["glossary_keywords"].extend(result["rows_after"].get("glossary_keywords", []))
                else:
                    skipped_remove.append(kw)

        if added or removed:
            from db.snapshot import get_changeset_store
            get_changeset_store().record_many(before_state, after_state)

        current = await glossary.get_glossary_for_node(node_uuid, namespace=get_namespace())

        lines = [f"Keywords for '{full_uri}':"]
        if added:
            lines.append(f"  Added: {', '.join(added)}")
        if skipped_add:
            lines.append(f"  Already existed (skipped): {', '.join(skipped_add)}")
        if removed:
            lines.append(f"  Removed: {', '.join(removed)}")
        if skipped_remove:
            lines.append(f"  Not found (skipped): {', '.join(skipped_remove)}")
        if current:
            lines.append(f"  Current: [{', '.join(current)}]")
        else:
            lines.append("  Current: (none)")

        return "\n".join(lines)

    except ValueError as e:
        return f"Error: {str(e)}"
    except Exception as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def search_memory(
    query: str, domain: Optional[str] = None, limit: int = 10
) -> str:
    """
    Search memories by path and content using full-text search.

    Use this when you don't know the URI for a memory. Do NOT guess URIs.
    This is lexical full-text search, NOT semantic search.

    Args:
        query: Search keywords (substring match)
        domain: Optional domain filter (e.g., "core", "writer").
                If not specified, searches all domains.
        limit: Maximum results (default 10)

    Returns:
        List of matching memories with URIs and snippets

    Examples:
        search_memory("job")                   # Search all domains
        search_memory("chapter", domain="writer") # Search only writer domain
    """
    search = get_search_indexer()

    try:
        # Validate domain if provided
        if domain is not None and domain not in VALID_DOMAINS:
            return f"Error: Unknown domain '{domain}'. Valid domains: {', '.join(VALID_DOMAINS)}"

        results = await search.search(query, limit, domain, namespace=get_namespace())

        if not results:
            scope = f"in '{domain}'" if domain else "across all domains"
            return f"No matching memories found {scope}."

        lines = [f"Found {len(results)} matches for '{query}':", ""]

        for item in results:
            uri = item.get(
                "uri", make_uri(item.get("domain", DEFAULT_DOMAIN), item["path"])
            )
            lines.append(f"- {uri}")
            lines.append(f"  Priority: {item['priority']}")
            if item.get("disclosure"):
                lines.append(f"  Disclosure: {item['disclosure']}")
            lines.append(f"  {item['snippet']}")
            lines.append("")

        return "\n".join(lines)

    except Exception as e:
        return f"Error: {str(e)}"


# =============================================================================
# MCP Resources
# =============================================================================


if __name__ == "__main__":
    mcp.run()
