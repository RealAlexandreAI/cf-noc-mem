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

## [2026-03-09 22:24:00] Docker 部署阻塞修复
- `backend/Dockerfile` 的 healthcheck 依赖 `curl`，若镜像只装 `libpq-dev` 和 `gcc`，`backend-api` 即使应用已启动也会因 `curl: not found` 被编排层判定为 unhealthy。
- `backend/db/sqlite_client.py` 中 `from backend...` 这类绝对导入在 Docker 的 `/app` 工作目录下会失效；容器内运行后端源码时应统一使用 `from db...` 这种相对项目根的导入方式。
- Docker Compose 中给 `postgresql+asyncpg://` 补 `?ssl=disable` 是连接本地 `postgres:16-alpine` 容器的必要条件，否则 asyncpg 会尝试 SSL 升级并被容器内 PostgreSQL 拒绝。
- `backend/mcp_server.py` 的 lifespan 里，SSE 进程必须通过 `SKIP_DB_INIT` 跳过 `init_db()`，把数据库初始化职责收敛到 API 容器，避免并发启动时的竞态。
- 本机宿主端口 `80` 被外部 openresty 占用时，Docker 验收可通过 `.env` 把 `NGINX_PORT` 调整为 `8080`；验收完成后要执行 `docker compose down -v`，确保不遗留容器与卷。 
