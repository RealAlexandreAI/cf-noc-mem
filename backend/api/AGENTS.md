# backend/api — REST API Layer

## OVERVIEW

Four `APIRouter` instances wired to `main.py` via `from backend.api import *` — human Dashboard endpoints that wrap `GraphService`/`ChangesetStore`/`GlossaryService`.

## STRUCTURE

```
api/
├── __init__.py         # Exports 4 routers: browse_router, review_router, maintenance_router, settings_router
├── browse.py           # GET/PUT/DELETE /browse/node, /browse/domains, /browse/namespaces, /browse/search, glossary CRUD
├── review.py           # GET /review/groups, diff, rollback, approve, clear-all; deprecated list; permanent delete
├── maintenance.py      # GET/DELETE /maintenance/orphans, access-log stats/prune
├── settings.py         # GET/PUT /settings, boot-uris CRUD, database test/create/open-folder
└── utils.py            # ⚠️ Misplaced text-diff utility (diff_match_patch), consumed by review /diff endpoint
```

## WHERE TO LOOK

| Task                                  | File              | Key function / endpoint             |
|---------------------------------------|-------------------|-------------------------------------|
| Add a browse endpoint                 | `browse.py`       | New `@router.get/post` under prefix |
| Change how pending changes are grouped| `review.py`       | `_get_causal_anchors()` — causal parent-pointer resolver |
| Modify rollback behavior              | `review.py`       | `rollback_group()` — 5-step revert (paths→edges→memories→glossary→FTS rebuild) |
| Add settings toggle                   | `settings.py`     | New field in `SettingsUpdate` + `config.set_value()` |
| Add a new router                     | new `xxx.py`      | `APIRouter(prefix="/xxx")`, export in `__init__.py`, `include_router` in `main.py` |
| Text diff between two strings        | `utils.py`        | `get_text_diff()` — returns HTML, unified, summary tuple |

## CONVENTIONS

- **One file per router**, each with `APIRouter(prefix="/xxx", tags=["xxx"])`. No mixed prefixes in one file.
- **Human vs AI distinction**: Dashboard endpoints (`browse` DELETE, glossary CRUD) intentionally bypass `ChangesetStore`. Only AI-authored mutations enter the review queue. New human-only endpoints: same pattern.
- **`nav_only` optimization**: `GET /browse/node?nav_only=true` skips glossary resolution and Aho-Corasick matching. Use when sidebar just needs child list.
- **Namespace handling**: Browse/maintenance/settings boot-uris respect `get_namespace()`. Review endpoints deliberately search ALL namespaces (`search_all_namespaces=True`) since audit is cross-agent.
- **Boot URI cleanup on delete**: `DELETE /browse/node` auto-strips deleted URI (and subtree prefixes) from boot URIs. No orphaned boot references.
- **Settings DB bypass**: `/settings/database/*` endpoints skip namespace isolation — they operate on the database connection itself.
- **Response shape**: Most endpoints return raw dicts, not Pydantic models. Pydantic schemas used only for request bodies (`BaseModel` subclasses) and review diff/group responses (`DiffResponse`, `ChangeGroup`, etc.).
- **Live DB fallback**: `_extract_content_and_meta_for_node()` in review.py queries the live database when changeset lacks complete before/after state. The changeset stores pointers (memory_id), not full content.

## ANTI-PATTERNS

1. **Don't put utility code in `api/utils.py`** — it's a misplaced module. New utilities go in `backend/core/` or `backend/utils/`. Existing `get_text_diff()` stays for backward compat but don't add to it.
2. **Don't add Pydantic response models to browse endpoints** — the pattern is raw dict returns. Only review endpoints and settings use typed responses.
3. **Don't restrict review endpoints to current namespace** — review is intentionally cross-namespace. Adding `get_namespace()` to review queries would break the audit dashboard.
4. **Don't wrap API routers inside `api/`** — this is the router layer itself. If you need shared middleware/auth logic for API routes, put it in `backend/auth.py` or `backend/namespace_middleware.py`, not in `api/`.
5. **Don't add changeset tracking to human dashboard mutations** — the review queue is for AI-authored changes only. Glossary CRUD, browse delete, and orphan purge are direct DB writes by design.
6. **Don't access `config.json` or `os.environ` directly in API files** — use `config.get()` / `config.set_value()` / `config.get_boot_uris()`. Settings endpoints use `config.set_boot_uris()` and `config.set_value()`, never raw file I/O.
