# Nocturne Memory — 项目知识库

**生成时间**: 2026-05-18
**提交**: 69aecbb
**分支**: fix/dashboard-ui-interactions
**版本**: 2.5.0

## 概述

Nocturne Memory 是一个基于 MCP 协议的 AI 长期记忆服务器。Python FastAPI 后端 + React/Vite 前端 + SQLite/PostgreSQL 存储。AI 通过 7 个 MCP 工具读写记忆；人类通过 Dashboard 可视化审计。

## 项目结构

```
nocturne_memory_dev/
├── backend/                  # Python FastAPI 后端 + MCP 服务
│   ├── main.py               # REST API 入口 (FastAPI + uvicorn)
│   ├── mcp_server.py         # MCP stdio 服务 + build_web_app() ASGI 组装器
│   ├── run_sse.py            # SSE/HTTP 统一进程入口 (生产用)
│   ├── mcp_wrapper.py        # Windows CRLF 兼容层 (Antigravity 专用)
│   ├── config.py             # 配置 SSoT (config.json)
│   ├── auth.py               # Bearer Token 认证 + CORS
│   ├── namespace_middleware.py # 命名空间隔离中间件
│   ├── system_views.py       # system:// URI 视图生成
│   ├── health.py             # 健康检查 (SELECT 1)
│   ├── text_patch.py         # Unicode 规范化 + 模糊补丁
│   ├── api/                  # REST API 路由 (4 个路由器)
│   ├── db/                   # 数据层 (ORM + 服务 + 迁移)
│   ├── models/               # Pydantic schemas
│   ├── tests/                # 测试 (4 层: unit/service/mcp/api)
│   └── scripts/              # 数据迁移脚本
├── frontend/                 # React/Vite Dashboard
│   ├── src/
│   │   ├── App.jsx           # 根组件 (路由 + 认证 + 命名空间)
│   │   ├── main.jsx          # React 入口
│   │   ├── lib/api.js        # API 客户端 (axios + 拦截器)
│   │   ├── components/       # 共享组件 (DiffViewer, TokenAuth, SnapshotList)
│   │   └── features/         # 功能模块 (memory/review/maintenance/settings)
│   ├── vite.config.js        # Vite 配置 (开发代理端口 8234)
│   ├── nginx.conf            # 生产 Nginx 配置
│   └── Dockerfile            # 多阶段构建 (node → nginx)
├── docs/                     # 文档 (skills/, images/, testing.md)
├── scripts/                  # 部署脚本 (setup_docker.py)
├── desktop_pet/              # 独立子系统 (心跳 + 语音气泡，与核心无关)
├── config.json               # 运行时配置 (gitignored)
├── demo.db                   # 演示数据库 (被 git 跟踪，1.3MB)
└── docker-compose.yml        # 三服务编排 (postgres + backend + nginx)
```

## 定位指南

| 任务 | 位置 | 备注 |
|------|------|------|
| 修改数据库模型 | `backend/db/models.py` | ORM 模型：Node/Memory/Edge/Path/GlossaryKeyword/SearchDocument |
| 添加/修改记忆操作 | `backend/db/graph.py` | GraphService — 所有 CRUD + GC + 诊断 |
| 添加 MCP 工具 | `backend/mcp_server.py` | `@mcp.tool()` 装饰器注册，约第 414 行起 |
| 添加 REST 端点 | `backend/api/*.py` | 按功能分文件：browse/review/settings/maintenance |
| 修改前端页面 | `frontend/src/features/*/` | 每个功能一个目录，App.jsx 中配置路由 |
| 修改全局配置项 | `backend/config.py` | `DEFAULTS` + `_ENV_MAP`；Dashboard Settings 面板自动读写 |
| 添加 system:// URI | `backend/system_views.py` | mcp_server.py `read_memory` 中注册新拦截 |
| 修改前端 API 调用 | `frontend/src/lib/api.js` | axios 实例 + 认证/命名空间拦截器 |
| 修改中间件行为 | `backend/auth.py` / `backend/namespace_middleware.py` | 顺序：CORS → Namespace → Auth → App |
| 修改数据库迁移 | `backend/db/migrations/` | 自定义迁移系统 (NNN_vX.Y.Z_description.py)，非 Alembic |

## 代码地图

| 模块 | 类型 | 位置 | 行数 | 角色 |
|------|------|------|------|------|
| GraphService | 类 | `backend/db/graph.py` | 2149 | 核心业务逻辑。所有记忆 CRUD、图遍历、GC、诊断 |
| mcp_server | 模块 | `backend/mcp_server.py` | 1179 | MCP 传输 + 7 个工具 + ASGI 组装 |
| review API | 模块 | `backend/api/review.py` | 845 | 审查/回滚 REST 端点 |
| MemoryBrowser | 组件 | `frontend/src/features/memory/MemoryBrowser.jsx` | 554 | 主记忆浏览器 UI |
| Config | 模块 | `backend/config.py` | 363 | 配置 SSoT，从 config.json 加载 |
| ChangesetStore | 类 | `backend/db/snapshot.py` | 380 | 变更快照记录与回滚 |
| SearchIndexer | 类 | `backend/db/search.py` | 393 | FTS 搜索引擎 |
| GlossaryService | 类 | `backend/db/glossary.py` | 284 | Aho-Corasick 豆辞典 + 超链接 |
| neo4j_client | 类 | `backend/db/neo4j_client.py` | 2247 | ⚠️ 遗留死代码 (Neo4j 迁移后不再使用) |

## 约定

### 配置管理
- **config.json 是唯一真理源**。绝不运行时读取 `.env`。`config.py` 提供 `get()` / `set_value()` / `get_boot_uris()`。
- 新增配置键 → 先在 `DEFAULTS` + `_ENV_MAP` 中声明。
- Docker 容器内 → `/.dockerenv` 检测改变 `ROOT_DIR`；缺失 `config.json` 直接抛 RuntimeError。

### 中间件顺序 (不可变)
```
CORSMiddleware → NamespaceMiddleware → BearerTokenAuthMiddleware → App
```
- CORS 处理 preflight；命名空间先设置 contextvars；认证跳过 `/health` 和 `/api/health`。
- SSE 模式的命名空间通过 session_id 文件映射持久化。

### 数据库
- **惰性初始化**：所有服务通过 `db/__init__.py` 的 `get_*_service()` 获取。禁止直接实例化。
- **自定义迁移系统**：`backend/db/migrations/NNN_vX.Y.Z_description.py`，由 `runner.py` 执行。非 Alembic。
- **自动 demo.db 迁移**：首次启动若指向 `demo.db` → 自动复制到 `nocturne_data*.db` 避免 git pull 覆盖。
- 遗留 `neo4j_client.py` (2247行) 是死代码，不要引用或修改。

### Python
- **无 pyproject.toml**。依赖通过 `backend/requirements.txt` + `requirements-dev.txt` 管理。
- **无 lint/格式工具** (无 ruff/flake8/black/mypy 配置)。
- **整个 `db/` 包静默了 pyright 类型检查** (6 个文件有文件级 `# pyright:` 抑制)。不要在 db/ 层依赖类型安全。

### 前端
- **纯 JSX，无 TypeScript**。无 `.ts`/`.tsx` 文件。`tsconfig.json` 不存在。
- **无 ESLint/Prettier**。无前端测试框架。
- **状态管理**：纯 React useState/useEffect，无 Redux。跨组件通信用 `CustomEvent`。
- **Vite 代理配置**：开发时 `/api` 代理到 `127.0.0.1:8234`，并 `rewrite` 剥除 `/api` 前缀。生产通过 Nginx 反向代理。
- **认证流**：token 存 localStorage → axios 拦截器附加 → 401 时清除 token + 分发 `AUTH_ERROR_EVENT` → App.jsx 显示 TokenAuth。

### 测试
- **asyncio_mode = auto** (无需装饰器)。测试在 `backend/tests/` 下按 `unit/` `service/` `mcp/` `api/` 四层组织。
- **每个测试函数独立 SQLite** (autouse fixture `isolated_test_environment`)。
- CI 双路径：SQLite 全量矩阵测试 + PostgreSQL smoke 测试。前端无 CI。

### 工具委托
- **Sisyphus**：AI 编排 agent。复杂任务分解后委托子 agent 并行执行，不亲自写代码。
- **子 agent 类别**：`visual-engineering`(前端)、`deep`(研究+实施)、`quick`(单文件修改)、`oracle`(只读架构顾问)。
- **探索委托**：`explore` agent (内部代码搜索)、`librarian` agent (外部文档/开源引用)。
- 项目自定义 skill：`memory-audit` 及其 5 个子技能 (docs/skills/ 下)。

### `desktop_pet/`
- 独立子系统 (心跳 + Tkinter 语音气泡 + TTS)。与 Nocturne Memory 核心无关。有自己的 `requirements.txt`。

## 反模式 (本项目特有)

1. **整文件 pyright 类型抑制** — `db/graph.py`、`db/database.py`、`db/search.py`、`db/models.py`、`db/glossary.py` 全部在文件级别关闭类型检查。**不要在 db/ 依赖类型安全，也不要新增此类抑制**。
2. **不要假设 system://index 展示所有子节点** — 索引只显示每个节点的主要路径，别名和隐藏子节点被省略。
3. **不要用 delete + create 做重命名/移动** — 用 `add_alias` + `delete_memory` (旧路径)。否则丢失 Memory ID 和全部关联。
4. **不要在 React 中使用 `window.prompt()`** — 使用模态/对话框组件替代。
5. **config.py 绝不写入 .env** — `.env` → `config.json` 迁移是单向且仅一次的。
6. **不要直接读 os.environ 或 config.json 文件** — 所有配置读取走 `config.get()`。
7. **不要在 api/ 中放置非路由代码** — `api/utils.py` 是历史遗留，新工具函数放 `backend/core/` 或 `backend/utils/`。

## 命令

```bash
# === 本地开发 ===
# 端口约定：8233 留给本机生产/SSE 实例，开发后端固定用 8234，避免撞端口。
# 推荐：根目录本地脚本会启动前后端，并打印 API Token 与带 token 的 Dashboard 链接。
./dev-services.sh start

# 手动启动后端热重载（开发端口 8234）
cd backend && uvicorn main:app --reload --port 8234

# 前端热重载 (另一终端，端口 3000，代理 API 到 8234)
cd frontend && npm run dev

# 或一键启动 (MCP + REST API + Dashboard 全在一个进程)
# 注意：这是生产/SSE 路径，默认读取 config.json 的 web_port；本机常驻实例通常占用 8233。
python backend/run_sse.py

# === 测试 ===
pip install -r backend/requirements.txt -r backend/requirements-dev.txt

# SQLite 全量测试
pytest backend/tests

# 带覆盖率
pytest backend/tests --cov=backend --cov-report=term-missing

# PostgreSQL smoke (仅 service + api 层)
export TEST_DATABASE_URL='postgresql+asyncpg://user:pass@127.0.0.1:5432/nocturne_memory'
pytest backend/tests/service backend/tests/api -q

# === 构建 ===
# 前端生产构建 (首次启动 MCP 时自动执行)
cd frontend && npm install && npm run build  # → frontend/dist/

# === Docker 部署 ===
python scripts/setup_docker.py          # 初始化 (生成密码 + token)
docker compose up -d --build            # 构建 + 启动全部服务
docker compose logs -f backend          # 查看日志
docker compose down                     # 停止 (保留数据)
```

## 注意事项

- `demo.db` (1.3MB) 意外被 git 跟踪。不要提交新的数据库文件。
- `config.json` 被 gitignore 但包含敏感 token，切勿强制提交。
- SSE 模式启动前必须设置 `_NOCTURNE_SSE_MODE=1` 防止 `mcp_server.py` 启动重复内嵌服务器。
- `backend/models/schemas.py` 命名不清晰：Pydantic schemas 在 `models/` 子目录下而非独立 `schemas/` 包。
- FastAPI 应用标题仍为旧名 "Knowledge Graph API" (main.py:49)。
- `package.json` 包名为 "memory-reviewer" 而非 "nocturne-memory-dashboard"。
- `frontend/src/components/` 和 `frontend/src/features/` 边界模糊：`DiffViewer` 和 `SnapshotList` 更像是 review 功能的一部分。
