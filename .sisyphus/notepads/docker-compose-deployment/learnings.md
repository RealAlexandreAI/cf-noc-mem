## [2026-03-09 22:03:55] Task 6: SSE Auth Integration
- run_sse.py 通过导入 BearerTokenAuthMiddleware 接入通用 ASGI Bearer Token 中间件。
- 需要先用 mcp.sse_app("/") 创建 Starlette SSE 应用，再以 excluded_paths=[] 包裹，确保 /sse 与 /messages/ 全量受保护。
- 保持 mcp_server.py 中已有的 dns_rebinding_protection=False、HOST/PORT 环境变量读取逻辑不变，且不在 SSE 进程做数据库初始化。
- 为验证启动链路，在临时虚拟环境中安装 backend 依赖，并通过 monkeypatch uvicorn.run 执行 run_sse.main()，确认应用可创建为 BearerTokenAuthMiddleware 包裹的 ASGI app。

