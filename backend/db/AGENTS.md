# backend/db/ — Data Layer

**Core data layer for Nocturne Memory**: ORM models, graph-domain business logic, search, glossary, snapshots, namespace isolation, and schema migrations.

## STRUCTURE

```
db/
├── __init__.py          # Lazy service locator (get_graph_service, get_db_manager, …) + model re-exports
├── models.py            # ORM: Node, Memory, Edge, Path, GlossaryKeyword, SearchDocument, MemoryAccessLog, ChangeCollector
├── graph.py             # GraphService (2149L) — all CRUD, graph traversal, version chains, GC, diagnostics
├── database.py          # DatabaseManager (154L) — engine creation, session factory, init_db (migration runner), close
├── namespace.py         # contextvars-based namespace isolation (get_namespace / set_namespace)
├── snapshot.py          # ChangesetStore (380L) — file-locked JSON before/after snapshots for review & rollback
├── glossary.py          # GlossaryService (284L) — Aho-Corasick multi-pattern matching, keyword→node bindings
├── search.py            # SearchIndexer (393L) — FTS engine (SQLite FTS5 / PostgreSQL tsvector), jieba tokenization
├── search_terms.py      # SearchTokenizer (107L) — custom jieba vocabulary for CJK + ASCII tokenization
├── neo4j_client.py      # ⚠️ DEAD CODE (2247L) — legacy Neo4j client, NOT referenced by any active path
└── migrations/          # 13 numbered scripts (NNN_vX.Y.Z_desc.py) + runner.py — NOT Alembic
```

## WHERE TO LOOK

| Task | File | Note |
|------|------|------|
| Add/modify ORM columns | `models.py` | Base declared here; `ROOT_NODE_UUID` sentinel too |
| Memory CRUD / graph ops | `graph.py` → Public Write API (L1276+) | `create_memory`, `update_memory`, `delete_memory`, `add_path`, `remove_path` |
| Graph traversal / reads | `graph.py` → Read Operations (L72+) | `get_memory_by_path`, `get_children`, `resolve_uri`, `get_node_statistics` |
| Session lifecycle | `database.py` | `DatabaseManager.session()` / `_optional_session()` context managers |
| FTS search | `search.py` | `search_memories`, `refresh_search_documents`, `rebuild_index` |
| Glossary / triggers | `glossary.py` | `manage_keyword`, `scan_content`, `get_glossary` |
| Snapshots / rollback | `snapshot.py` | `record_change`, `get_changes`, `accept_change`, `reject_change` |
| Namespace isolation | `namespace.py` | `get_namespace()` reads contextvar; set per-request by middleware |
| Migration scripts | `migrations/` + `runner.py` | Auto-executed at startup; SQLite gets backed up first |
| Public imports | `__init__.py` | `from backend.db import get_graph_service, …` |

## CONVENTIONS

### Service Initialization
- 所有服务通过 `db/__init__.py` 的 `get_*()` 惰性获取。禁止直接 `GraphService(db, search)`。
- 初始化链: `DatabaseManager(url)` → `SearchIndexer(db)` → `GlossaryService(db, search)` → `GraphService(db, search)`。
- 服务共享单一 `DatabaseManager` 实例。Session 通过 `db.session()` async context manager 获取。
- `close_db()` 清理全局单例；测试需在 teardown 中调用。

### GraphService Internal Hierarchy (不可破坏)
```
Public Write API (L1276+)  →  delegates to Layer 3
Layer 3: GC / Conditional   →  delegates to Layer 2
Layer 2: Cross-Table Cascade →  delegates to Layer 1
Layer 1: Table-Scoped Ops   →  delegates to Layer 0
Layer 0: Row-Level Primitives  →  raw SQLAlchemy, takes session as first arg
```
- Layer 0–3 方法全部接收 `AsyncSession` 为第一参数，**从不自己打开事务**。只有 Public API 打开 session。
- 新增内部方法 → 放入对应 Layer，不要跨 Layer 调用。
- `ChangeCollector` 在 mutation 调用链中透传，记录删除前的行数据供快照使用。

### Namespace
- 所有查询必须携带 `namespace` 参数（contextvars 透传）。`namespace=""` 为默认空间。
- `Path` 表的主键是 `(namespace, domain, path)` 三元组。别名在不同 namespace 间完全隔离。
- Glossary keyword 按 `(keyword, node_uuid, namespace)` 去重。

### Snapshots
- `ChangesetStore` 使用 JSON 文件 + `filelock` 记录 `before` / `after` 行状态。
- 首次触碰 PK: 记录 `before`；后续同一 PK: 仅覆盖 `after`；`before == after` 的变更在展示时自动过滤。
- 表优先级顺序: nodes → memories → edges → paths → glossary_keywords。

### Migrations
- `runner.py` 在 `init_db()` 时按序号顺序执行 pending 脚本。
- SQLite: 迁移前自动备份（`.db.YYYYMMDD_HHMMSS.bak`）。PostgreSQL: 无自动 backup，手动 `pg_dump`。
- 每个迁移脚本是独立 async 函数 `async def run(engine: AsyncEngine)`。

## ANTI-PATTERNS

1. **直接实例化服务** — 用 `from backend.db import get_graph_service`，不要 `GraphService(db, search)`。
2. **在 db/ 内依赖类型安全** — 全部 6 个源文件顶部有 `# pyright:` 抑制。不要新增类型注解依赖。
3. **跨 Layer 调用** — 不要在 Layer 0 里调用 Layer 3。不要在 Public API 里绕过 Layer 3 直接操作表。
4. **引用 neo4j_client.py** — 死代码。任何 import 或修改都视为架构错误。
5. **硬编码 namespace** — 始终从 `get_namespace()` 获取。不要假设 `""`。
6. **在 Layer 方法内打开 session** — Layer 内部方法只接收 session 参数，session 生命周期由 Public API 管理。
7. **绕过 ChangesetStore 做写操作** — 所有 Public Write API 操作自动记录 changeset。手动 SQL 写入会破坏审计链。
8. **手动写 SQLite migration** — 用 runner 框架的 `async def run(engine)`，不要直接执行 `PRAGMA` 或裸 DDL。
