## [2026-03-09 22:03:55] Task 6: SSE Auth Integration
- run_sse.py 通过导入 BearerTokenAuthMiddleware 接入通用 ASGI Bearer Token 中间件。
- 需要先用 mcp.sse_app("/") 创建 Starlette SSE 应用，再以 excluded_paths=[] 包裹，确保 /sse 与 /messages/ 全量受保护。
- 保持 mcp_server.py 中已有的 dns_rebinding_protection=False、HOST/PORT 环境变量读取逻辑不变，且不在 SSE 进程做数据库初始化。
- 为验证启动链路，在临时虚拟环境中安装 backend 依赖，并通过 monkeypatch uvicorn.run 执行 run_sse.main()，确认应用可创建为 BearerTokenAuthMiddleware 包裹的 ASGI app。

## 2026-03-09 Task 5: Auth Integration + PG Compat

- `backend/main.py` 已接入 `BearerTokenAuthMiddleware`，并通过 `excluded_paths=["/health"]` 放行健康检查。
- FastAPI/Starlette 中间件执行顺序是“后添加的先执行”，因此要先添加认证中间件、再添加现有 `CORSMiddleware`，这样浏览器 CORS 预检不会被 401 拦截。
- `backend/health.py` 导出变量名为 `router`，注册后会使用 `get_db_client()` + `SELECT 1` 做真实数据库健康检查，不应继续保留 `main.py` 内联的假 `/health`。
- `backend/db/sqlite_client.py` 已原生读取 `DATABASE_URL` 环境变量；`postgresql+asyncpg://` 会被识别为 PostgreSQL，并走 async engine / pooling 配置。
- 当前 ORM 表仅使用 `String`、`Integer`、`Text`、`Boolean`、`DateTime`、`ForeignKey`、`UniqueConstraint`，均可被 PostgreSQL 方言正常编译；`backend/models/schemas.py` 仅含 Pydantic DTO，和底层数据库类型无耦合。
- 启动验证使用独立虚拟环境 `/tmp/nocturne-backend-verify`：`/health` 返回 200 且 `database=connected`，受保护根路由未带 token 返回 401，带 Bearer token 返回 200，CORS 预检返回 200 并带 `access-control-allow-origin`。
