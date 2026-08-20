// cf-noc-mem panel, structure aligned with upstream nocturne_memory UI:
//   Review (default) / Memory / Maintenance + Settings drawer + token auth.
// Trimmed concepts (namespaces/domains/presets/glossary) are not rendered.
// Server injects: __AUTH_MODE__ / __STATUS_TEXT__ / __STATUS_CLASS__ /
//   __AUTH_ZONE_HTML__ / __BOOT_DATA__ (JSON, type=application/json script).
export const UI_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cf-noc-mem</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0b0b10;
    --panel: #14141a;
    --panel-2: #1a1a22;
    --border: #26262f;
    --border-2: #33333f;
    --text: #e8e8ee;
    --text-2: #9b9ba8;
    --text-3: #6b6b78;
    --accent: #5e6ad2;
    --accent-2: #8b93e8;
    --green: #3fb68b;
    --red: #e2605f;
    --amber: #d9a13b;
    --radius: 10px;
    --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", sans-serif;
    background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .shell { display: grid; grid-template-columns: 230px 1fr; min-height: 100dvh; }
  aside {
    border-right: 1px solid var(--border); padding: 24px 18px;
    display: flex; flex-direction: column; gap: 18px; background: var(--panel);
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand-mark {
    width: 26px; height: 26px; border-radius: 7px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 600; color: #fff;
  }
  .brand-name { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
  .brand-sub { font-size: 11px; color: var(--text-3); }
  .status { font-size: 12px; color: var(--text-2); display: flex; align-items: center; gap: 8px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); }
  .dot.ok { background: var(--green); }
  nav { display: flex; flex-direction: column; gap: 2px; }
  .nav-item {
    display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px;
    font-size: 13px; color: var(--text-2); cursor: pointer; border: 0; background: transparent; text-align: left;
    transition: background 0.12s, color 0.12s;
  }
  .nav-item:hover { background: var(--panel-2); color: var(--text); }
  .nav-item.active { background: var(--panel-2); color: var(--text); }
  .nav-item .k { width: 16px; text-align: center; font-size: 11px; color: var(--text-3); }
  .nav-item.active .k { color: var(--accent-2); }
  .spacer { flex: 1; }
  .icon-btn {
    background: transparent; border: 1px solid var(--border); border-radius: 8px;
    color: var(--text-2); padding: 8px; cursor: pointer; font-size: 14px;
    transition: background 0.12s, border-color 0.12s;
  }
  .icon-btn:hover { background: var(--panel-2); border-color: var(--border-2); }
  .field label { display: block; font-size: 11px; color: var(--text-3); margin-bottom: 6px; }
  .field input {
    width: 100%; background: var(--panel-2); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px;
    font-family: var(--mono); font-size: 12px; outline: none; transition: border-color 0.15s;
  }
  .field input:focus { border-color: var(--accent); }
  .hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }
  .btn {
    background: var(--accent); color: #fff; border: 0; border-radius: 8px;
    padding: 8px 14px; font-size: 13px; font-weight: 500; cursor: pointer;
    transition: background 0.15s, transform 0.05s;
  }
  .btn:hover { background: #6b77e0; }
  .btn:active { transform: translateY(1px); }
  .btn.ghost { background: transparent; color: var(--text-2); border: 1px solid var(--border); }
  .btn.ghost:hover { background: var(--panel-2); color: var(--text); }
  .btn.danger { background: transparent; color: var(--red); border: 1px solid rgba(226,96,95,.4); }
  .btn.danger:hover { background: rgba(226,96,95,.1); }
  main { padding: 28px 32px; max-width: 980px; }
  .topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; gap: 12px; flex-wrap: wrap; }
  .search-row { display: flex; gap: 10px; flex: 1; min-width: 260px; }
  .search-row input {
    flex: 1; background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px;
    font-size: 14px; outline: none; transition: border-color 0.15s;
  }
  .search-row input:focus { border-color: var(--accent); }
  .section-label { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; }
  .item {
    padding: 13px 16px; border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--panel); margin-bottom: 8px;
    transition: border-color 0.15s, background 0.15s;
  }
  .item:hover { border-color: var(--border-2); background: var(--panel-2); }
  .item .uri { font-family: var(--mono); font-size: 12px; color: var(--accent-2); margin-bottom: 4px; word-break: break-all; }
  .item .body { font-size: 13px; color: var(--text-2); white-space: pre-wrap; word-break: break-word; }
  .item .meta { font-size: 11px; color: var(--text-3); margin-top: 6px; font-family: var(--mono); }
  .tag { display: inline-block; padding: 1px 7px; border-radius: 5px; font-size: 10px; margin-right: 8px; text-transform: uppercase; letter-spacing: 0.05em; }
  .tag.create { background: rgba(63,182,139,.14); color: var(--green); }
  .tag.update { background: rgba(94,106,210,.16); color: var(--accent-2); }
  .tag.delete { background: rgba(226,96,95,.14); color: var(--red); }
  .tag.alias { background: rgba(217,161,59,.14); color: var(--amber); }
  .row { display: flex; gap: 10px; align-items: center; }
  .diff { border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel); padding: 14px 16px; margin-bottom: 10px; }
  .diff .lbl { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
  .diff pre { font-family: var(--mono); font-size: 12px; color: var(--text-2); white-space: pre-wrap; word-break: break-word; margin: 0; }
  .skel { border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; margin-bottom: 8px; }
  .skel .line { height: 10px; border-radius: 5px; background: var(--panel-2); margin-bottom: 8px; animation: pulse 1.4s ease-in-out infinite; }
  .skel .line:last-child { margin-bottom: 0; }
  @keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
  .empty { color: var(--text-3); font-size: 13px; padding: 24px 0; text-align: center; }
  .err { color: var(--red); font-size: 13px; padding: 12px 0; }
  .token-form { border: 1px solid var(--border); border-radius: var(--radius); padding: 18px; background: var(--panel); display: flex; flex-direction: column; gap: 12px; }
  .auth-banner { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); color: var(--text-2); }
  .auth-banner .ok { color: var(--green); }
  .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
  .stat { border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel); padding: 13px 15px; }
  .stat .v { font-size: 21px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .stat .l { font-size: 11px; color: var(--text-3); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.06em; }
  .actions { display: flex; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
  .drawer-bg { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: none; }
  .drawer-bg.open { display: block; }
  .drawer {
    position: fixed; top: 0; right: 0; bottom: 0; width: 340px; max-width: 90vw;
    background: var(--panel); border-left: 1px solid var(--border); padding: 24px;
    display: flex; flex-direction: column; gap: 16px; transform: translateX(100%);
    transition: transform 0.18s ease;
  }
  .drawer.open { transform: translateX(0); }
  .drawer h3 { font-size: 14px; font-weight: 600; }
  .kv { font-size: 12px; color: var(--text-2); font-family: var(--mono); word-break: break-all; }
  .kv b { color: var(--text-3); font-weight: 500; }
  @media (max-width: 768px) {
    .shell { grid-template-columns: 1fr; }
    aside { border-right: 0; border-bottom: 1px solid var(--border); padding: 16px; }
    main { padding: 18px; }
  }
</style>
</head>
<body>
<div class="shell">
  <aside>
    <div class="brand">
      <div class="brand-mark">N</div>
      <div>
        <div class="brand-name">cf-noc-mem</div>
        <div class="brand-sub">memory on cloudflare</div>
      </div>
    </div>
    <div class="status"><span class="dot__STATUS_CLASS__"></span><span id="statusText">__STATUS_TEXT__</span></div>
    <nav>
      <button class="nav-item active" data-view="review"><span class="k">&#9998;</span>Review</button>
      <button class="nav-item" data-view="memory"><span class="k">&#9776;</span>Memory</button>
      <button class="nav-item" data-view="maintenance"><span class="k">&#9881;</span>Maintenance</button>
    </nav>
    <div id="authZone">__AUTH_ZONE_HTML__</div>
    <div class="spacer"></div>
    <button class="icon-btn" id="settingsBtn" title="settings">&#9881; Settings</button>
  </aside>
  <main>
    <div class="topbar">
      <div class="search-row" id="searchRow">
        <input id="q" placeholder="search memories" autocomplete="off" spellcheck="false">
        <button class="btn" id="go">Search</button>
      </div>
    </div>
    <div class="section-label" id="sectionLabel">review</div>
    <div id="out"></div>
  </main>
</div>
<div class="drawer-bg" id="drawerBg"></div>
<div class="drawer" id="drawer">
  <h3>Settings</h3>
  <div class="kv"><b>mcp</b> <br>POST /mcp (Streamable HTTP, Bearer)</div>
  <div class="kv"><b>panel</b> <br>/admin (Access or Bearer)</div>
  <div class="kv"><b>snapshot</b> <br>daily 03:00 UTC to R2</div>
  <div class="hint">trimmed from upstream: namespaces, domains, presets, glossary, web UI write ops.</div>
</div>
<script type="application/json" id="bd">__BOOT_DATA__</script>
<script>
var MODE = "__AUTH_MODE__";
var TOK = localStorage.getItem("nm-token") || "";
var OUT = document.getElementById("out");
var Q = document.getElementById("q");
var SECTION = document.getElementById("sectionLabel");
var SEARCH_ROW = document.getElementById("searchRow");
var BOOT = (function () { var r = document.getElementById("bd").textContent; return r === "null" ? null : JSON.parse(r); })();
var NAV = document.querySelectorAll(".nav-item");
var ACTIVE = "review";
var CURRENT_AUDIT_ID = null;

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function authHeaders() { var h = {}; if (MODE === "bearer" && TOK) h["Authorization"] = "Bearer " + TOK; return h; }
function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign(authHeaders(), opts.headers || {});
  return fetch(path, opts).then(function (r) {
    if (r.status === 401) throw new Error("unauthorized");
    return r.json();
  });
}
function skeleton() {
  OUT.innerHTML = '<div class="skel"><div class="line" style="width:40%"></div><div class="line" style="width:90%"></div><div class="line" style="width:70%"></div></div>' +
    '<div class="skel"><div class="line" style="width:55%"></div><div class="line" style="width:85%"></div></div>';
}
function fail(e) { OUT.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; }
function setSection(t) { SECTION.textContent = t; }

function itemHtml(uri, body, meta) {
  return '<div class="item"><div class="uri">' + esc(uri) + '</div><div class="body">' + esc(body) + '</div>' + (meta ? '<div class="meta">' + meta + '</div>' : '') + '</div>';
}

function renderBoot(text) {
  var blocks = text.split(/\\n{2,}/).filter(Boolean);
  if (!blocks.length) { OUT.innerHTML = '<div class="empty">no memories yet. write via MCP: create_memory(core://agent, ...)</div>'; return; }
  OUT.innerHTML = blocks.map(function (b) {
    var m = b.match(/^([a-z]+:\\/\\/[^\\n]+)\\n?([\\s\\S]*)$/);
    if (m) return itemHtml(m[1], m[2].trim());
    return itemHtml("", b.trim());
  }).join("");
}

function renderEntries(entries) {
  if (!entries || !entries.length) { OUT.innerHTML = '<div class="empty">no memories</div>'; return; }
  OUT.innerHTML = entries.map(function (e) {
    return itemHtml(e.uri, e.title, "p" + e.priority + " &middot; " + esc(String(e.updated_at || "").slice(0, 19)));
  }).join("");
}

function renderAudit(entries) {
  if (!entries || !entries.length) { OUT.innerHTML = '<div class="empty">no activity yet</div>'; return; }
  OUT.innerHTML = entries.map(function (a) {
    return '<div class="item" style="cursor:pointer" onclick="openAudit(' + a.id + ')">' +
      '<div class="uri">' + esc(a.uri || "(system)") + '</div>' +
      '<div class="meta"><span class="tag ' + esc(a.op) + '">' + esc(a.op) + '</span>' + esc(String(a.created_at || "").slice(0, 19)) + '</div></div>';
  }).join("");
}

function renderStatus(st) {
  var keys = [["nodes", "nodes"], ["memories", "memories"], ["edges", "edges"], ["paths", "paths"], ["triggers", "triggers"], ["audit", "audit"], ["fts", "fts docs"], ["snapshots", "snapshots"]];
  var cards = keys.map(function (k) { return '<div class="stat"><div class="v">' + esc(String(st[k[0]] ?? 0)) + '</div><div class="l">' + k[1] + '</div></div>'; }).join("");
  OUT.innerHTML = '<div class="stats">' + cards + '</div>' +
    (st.last_snapshot ? '<div class="hint" style="margin-top:12px">last snapshot: ' + esc(st.last_snapshot) + '</div>' : '') +
    '<div class="actions">' +
    '<button class="btn" onclick="doSnapshot()">Take snapshot</button>' +
    '<button class="btn ghost" onclick="doRebuild()">Rebuild search index</button>' +
    '</div>';
}

function setView(v) {
  ACTIVE = v; CURRENT_AUDIT_ID = null;
  NAV.forEach(function (n) { n.className = "nav-item" + (n.getAttribute("data-view") === v ? " active" : ""); });
  SEARCH_ROW.style.display = v === "memory" ? "" : "none";
  skeleton();
  if (v === "review") { setSection("review"); api("/admin/audit").then(function (d) { renderAudit(d.entries); }).catch(fail); }
  else if (v === "memory") { setSection("memory"); api("/admin/all").then(function (d) { renderEntries(d.entries); }).catch(fail); }
  else if (v === "maintenance") { setSection("maintenance"); api("/admin/status").then(renderStatus).catch(fail); }
}

function openAudit(id) {
  CURRENT_AUDIT_ID = id; skeleton(); setSection("review #" + id);
  api("/admin/audit/" + id).then(function (d) {
    var a = d.audit;
    var before = a.before_json ? JSON.stringify(JSON.parse(a.before_json), null, 2) : "—";
    var after = a.after_json ? JSON.stringify(JSON.parse(a.after_json), null, 2) : "—";
    OUT.innerHTML =
      '<div class="item"><div class="uri">' + esc(a.uri || "(system)") + '</div>' +
      '<div class="meta"><span class="tag ' + esc(a.op) + '">' + esc(a.op) + '</span>' + esc(String(a.created_at || "").slice(0, 19)) + '</div></div>' +
      '<div class="diff"><div class="lbl">before</div><pre>' + esc(before) + '</pre></div>' +
      '<div class="diff"><div class="lbl">after</div><pre>' + esc(after) + '</pre></div>' +
      '<div class="actions"><button class="btn danger" onclick="doRollback(' + a.id + ')">Rollback</button>' +
      '<button class="btn ghost" onclick="setView(\'review\')">Back</button></div>';
  }).catch(fail);
}

function doRollback(id) {
  if (!window.confirm("Rollback audit #" + id + "?")) return;
  skeleton();
  api("/admin/audit/" + id + "/rollback", { method: "POST" }).then(function (r) {
    OUT.innerHTML = '<div class="item"><div class="body">' + esc(r.message) + '</div></div><div class="actions"><button class="btn ghost" onclick="setView(\'review\')">Back to review</button></div>';
  }).catch(fail);
}

function doSnapshot() {
  skeleton(); api("/admin/snapshot", { method: "POST" }).then(function (r) {
    OUT.innerHTML = '<div class="item"><div class="body">snapshot: ' + esc(r.key) + '</div></div><div class="actions"><button class="btn ghost" onclick="setView(\'maintenance\')">Back</button></div>';
  }).catch(fail);
}
function doRebuild() {
  skeleton(); api("/admin/rebuild-search", { method: "POST" }).then(function () {
    OUT.innerHTML = '<div class="item"><div class="body">search index rebuilt</div></div><div class="actions"><button class="btn ghost" onclick="setView(\'maintenance\')">Back</button></div>';
  }).catch(fail);
}

function doSearch() {
  var q = Q.value.trim();
  if (!q) { setView(ACTIVE); return; }
  skeleton(); setSection("search: " + q);
  api("/admin/search?q=" + encodeURIComponent(q)).then(function (d) {
    if (!d.hits || !d.hits.length) { OUT.innerHTML = '<div class="empty">no results</div>'; return; }
    OUT.innerHTML = d.hits.map(function (h) { return itemHtml(h.uri, h.snippet || "", "p" + (h.priority || 0)); }).join("");
  }).catch(fail);
}

function unlock() {
  TOK = document.getElementById("tok").value.trim();
  localStorage.setItem("nm-token", TOK);
  setView("review");
}

NAV.forEach(function (n) { n.addEventListener("click", function () { setView(n.getAttribute("data-view")); }); });
document.getElementById("go").addEventListener("click", doSearch);
Q.addEventListener("keydown", function (e) { if (e.key === "Enter") doSearch(); });

var dBg = document.getElementById("drawerBg"), dDrawer = document.getElementById("drawer");
document.getElementById("settingsBtn").addEventListener("click", function () { dBg.className = "drawer-bg open"; dDrawer.className = "drawer open"; });
dBg.addEventListener("click", function () { dBg.className = "drawer-bg"; dDrawer.className = "drawer"; });

if (MODE === "bearer") {
  var tokGo = document.getElementById("tokGo");
  if (tokGo) tokGo.addEventListener("click", unlock);
  var tokInp = document.getElementById("tok");
  if (tokInp) tokInp.addEventListener("keydown", function (e) { if (e.key === "Enter") unlock(); });
  if (TOK) setView("review");
} else {
  setView("review");
}
</script>
</body>
</html>`;
