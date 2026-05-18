# features/ — Nocturne Memory Dashboard 功能模块

## 概览

4 个功能模块, 16 个 JSX 文件, ~3200 行。纯 React + Tailwind, 无路由嵌套——所有导入直接在 App.jsx 中完成。

## 结构

```
features/
├── memory/                          # 主记忆浏览器 (≈Dashboard)
│   ├── MemoryBrowser.jsx     (554)  # 单体组件: 树浏览/编辑/搜索/删除/子节点网格
│   └── components/
│       ├── MemorySidebar.jsx (213)  # 递归域名树, TreeNode 惰性加载子节点 (nav_only=true)
│       ├── NodeGridCard.jsx   (86)  # 子节点卡片: boot 开关 + disclosure/priority 徽章
│       ├── Breadcrumb.jsx     (33)  # 路径面包屑导航
│       ├── PriorityBadge.jsx  (28)  # 颜色映射: 0=rose, 1-2=amber, 3-5=sky, >5=slate
│       ├── GlossaryHighlighter.jsx (204) # 行内关键词高亮 + Portal 弹窗显示关联节点
│       └── KeywordManager.jsx (90)  # 添加/删除索引关键词
├── review/                           # 变更审查
│   └── ReviewPage.jsx         (436)  # 快照列表 + 并排 diff + 接受/拒绝/回滚
├── maintenance/                      # 记忆清理
│   └── MaintenancePage.jsx    (455)  # 孤儿/废弃记忆列表, 批量删除, 访问日志清理
└── settings/                         # 配置面板 (右上角齿轮)
    ├── SettingsDrawer.jsx     (174)  # 滑出面板 + 标签页 (General/Database/Memory)
    ├── Section.jsx             (24)  # 可折叠区域包装器
    ├── ServerSection.jsx       (82)  # 端口/主机名
    ├── DatabaseSection.jsx    (248)  # DB 连接路径 + 状态
    ├── BootUrisSection.jsx    (294)  # 启动 URI 列表编辑
    ├── DomainsSection.jsx     (100)  # 有效域名管理
    └── AdvancedSection.jsx    (155)  # 杂项高级设置
```

## 查找指南

| 需求 | 位置 | 备注 |
|------|------|------|
| 修改记忆浏览主界面 | `memory/MemoryBrowser.jsx` | 单体 554 行, 无内部 section 头——用 `searchParams` 做导航状态 |
| 修改树形侧边栏 | `memory/components/MemorySidebar.jsx` | TreeNode 递归, `nav_only=true` 惰性加载 |
| 添加/修改审查流程 | `review/ReviewPage.jsx` | diff 查看器在 `../../components/DiffViewer` |
| 修改清理/孤儿记忆逻辑 | `maintenance/MaintenancePage.jsx` | 含 `window.prompt()` 反模式 |
| 添加新设置面板 | `settings/SettingsDrawer.jsx` + 新建 Section | 标签页在 Drawer 内用 `activeTab` state 控制 |
| 修改豆辞典高亮行为 | `memory/components/GlossaryHighlighter.jsx` | Portal 弹窗 + `indexOf` 匹配 |
| 修改优先级颜色 | `memory/components/PriorityBadge.jsx` | 仅 28 行, 纯展示 |

## 约定

- **无 barrel exports** — App.jsx 直接导入: `import MemoryBrowser from './features/memory/MemoryBrowser'`
- **所有 API 调用走 `../../lib/api`** (或 `../../../lib/api` 子组件)。特征是: `api.get/post/delete`, `getSettingsBootUris`, `toggleSettingsBootUri` 等具名导出。
- **MemoryBrowser 导航**: URL search params (`?domain=X&path=Y`) 是唯一状态源。`useEffect([domain, path])` 触发数据获取, `setSearchParams` 驱动导航。
- **跨组件通信**: `CustomEvent`. SettingsDrawer 监听 `window.addEventListener('open-settings', ...)` 由导航栏派发。GlossaryHighlighter 用 `document.addEventListener('mousedown', ...)` 关闭弹窗。
- **编辑模式**: MemoryBrowser 内联编辑 (content/disclosure/priority), 无独立编辑器路由。`setEditing(true)` 后直接在 `<textarea>` 内修改。
- **删除操作**: 先设 `deleteTarget`, 弹出确认模态, 再调 `deleteNode`。Review 的接受/拒绝即时生效, 无需二次确认。
- **SettingsDrawer 惰性加载**: 滑出时才 `loadAll()`, 关闭时不保活 state。
- **所有组件均为 default export** — 无具名导出。

## 反模式 (features/ 范围)

1. **`window.prompt()` / `window.alert()`** — `MaintenancePage.jsx:42` 用 `window.prompt` 获取日志保留天数, `alert` 显示错误。禁止新增此类调用 — 用模态/内联表单替代。
2. **单体巨组件** — `MemoryBrowser.jsx` 554 行单文件承载浏览/编辑/搜索/删除/子节点网格。新增功能考虑抽为子组件而非继续膨胀。
3. **features/ 与 components/ 边界模糊** — `DiffViewer` 和 `SnapshotList` 在 `../../components/` 但实质是 review 专属。新 review/memory 专属组件应放在对应 feature 的 `components/` 子目录, 不要污染共享层。
4. **不要新建 index.js barrel** — 项目显式不采用。保持全路径导入。
5. **不要在 MemoryBrowser 里分段 header** — 当前无 `<h2>` 等节标题。新节如需标题保持内联 style 风格 (`text-sm text-slate-400` 类 span)。
