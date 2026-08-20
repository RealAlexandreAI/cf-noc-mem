// Read-only memory browser. Linear-style dark, single file, no deps.
// Server renders mode banner + boot data; JS handles views & search.
// Placeholders replaced by worker:
//   __AUTH_MODE__ / __STATUS_TEXT__ / __STATUS_CLASS__ / __AUTH_ZONE_HTML__
//   __BOOT_DATA__ (JSON in a type=application/json script tag)
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
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .shell { display: grid; grid-template-columns: 240px 1fr; min-height: 100dvh; }
  aside {
    border-right: 1px solid var(--border);
    padding: 24px 18px;
    display: flex;
    flex-direction: column;
    gap: 18px;
    background: var(--panel);
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
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px; border-radius: 8px;
    font-size: 13px; color: var(--text-2); cursor: pointer;
    border: 0; background: transparent; text-align: left;
    transition: background 0.12s, color 0.12s;
  }
  .nav-item:hover { background: var(--panel-2); color: var(--text); }
  .nav-item.active { background: var(--panel-2); color: var(--text); }
  .nav-item .k { width: 16px; text-align: center; font-size: 11px; color: var(--text-3); }
  .nav-item.active .k { color: var(--accent-2); }
  .field label { display: block; font-size: 11px; color: var(--text-3); margin-bottom: 6px; }
  .field input {
    width: 100%; background: var(--panel-2); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px;
    padding: 8px 10px; font-family: var(--mono); font-size: 12px;
    outline: none; transition: border-color 0.15s;
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
  main { padding: 28px 32px; max-width: 960px; }
  .topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; gap: 12px; flex-wrap: wrap; }
  .search-row { display: flex; gap: 10px; flex: 1; min-width: 260px; }
  .search-row input {
    flex: 1; background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 14px; font-size: 14px; outline: none;
    transition: border-color 0.15s;
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
  .item .meta .tag { display: inline-block; padding: 1px 7px; border-radius: 5px; font-size: 10px; margin-right: 8px; text-transform: uppercase; letter-spacing: 0.05em; }
  .tag.create { background: rgba(63,182,139,.14); color: var(--green); }
  .tag.update { background: rgba(94,106,210,.16); color: var(--accent-2); }
  .tag.delete { background: rgba(226,96,95,.14); color: var(--red); }
  .tag.alias { background: rgba(217,161,59,.14); color: var(--amber); }
  .skel { border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; margin-bottom: 8px; }
  .skel .line { height: 10px; border-radius: 5px; background: var(--panel-2); margin-bottom: 8px; animation: pulse 1.4s ease-in-out infinite; }
  .skel .line:last-child { margin-bottom: 0; }
  @keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
  .empty { color: var(--text-3); font-size: 13px; padding: 24px 0; text-align: center; }
  .err { color: var(--red); font-size: 13px; padding: 12px 0; }
  .token-form { border: 1px solid var(--border); border-radius: var(--radius); padding: 18px; background: var(--panel); display: flex; flex-direction: column; gap: 12px; }
  .auth-banner {
    display: flex; align-items: center; gap: 8px; font-size: 12px;
    padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border);
    color: var(--text-2);
  }
  .auth-banner .ok { color: var(--green); }
  .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; }
  .stat { border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel); padding: 14px 16px; }
  .stat .v { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .stat .l { font-size: 11px; color: var(--text-3); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.06em; }
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
      <button class="nav-item active" data-view="overview"><span class="k">&#9679;</span>Overview</button>
      <button class="nav-item" data-view="all"><span class="k">&#9776;</span>All memories</button>
      <button class="nav-item" data-view="recent"><span class="k">&#8635;</span>Recent</button>
      <button class="nav-item" data-view="audit"><span class="k">&#9998;</span>Audit</button>
      <button class="nav-item" data-view="status"><span class="k">&#9635;</span>Status</button>
    </nav>
    <div id="authZone">__AUTH_ZONE_HTML__</div>
    <div class="hint">boot memories, full-text search, recent writes and audit trail. data stays in D1.</div>
  </aside>
  <main>
    <div class="topbar">
      <div class="search-row">
        <input id="q" placeholder="search memories" autocomplete="off" spellcheck="false">
        <button class="btn" id="go">Search</button>
      </div>
    </div>
    <div class="section-label" id="sectionLabel">overview</div>
    <div id="out"></div>
  </main>
</div>
<script type="application/json" id="bd">__BOOT_DATA__</script>
<script>
var MODE = "__AUTH_MODE__";
var TOK = localStorage.getItem("nm-token") || "";
var OUT = document.getElementById("out");
var Q = document.getElementById("q");
var SECTION = document.getElementById("sectionLabel");
var BOOT = (function () {
  var raw = document.getElementById("bd").textContent;
  return raw === "null" ? null : JSON.parse(raw);
})();
var NAV = document.querySelectorAll(".nav-item");
var ACTIVE = "overview";
if (BOOT !== null) renderBoot(BOOT); else skeleton();

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function authHeaders() { var h = {}; if (MODE === "bearer" && TOK) h["Authorization"] = "Bearer " + TOK; return h; }
function api(path) {
  return fetch(path, { headers: authHeaders() }).then(function (r) {
    if (r.status === 401) throw new Error("unauthorized");
    return r.json();
  });
}
function skeleton() {
  OUT.innerHTML = '<div class="skel"><div class="line" style="width:40%"></div><div class="line" style="width:90%"></div><div class="line" style="width:70%"></div></div>' +
    '<div class="skel"><div class="line" style="width:55%"></div><div class="line" style="width:85%"></div></div>';
}

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
    return itemHtml(a.uri || "(system)", "", '<span class="tag ' + esc(a.op) + '">' + esc(a.op) + '</span>' + esc(String(a.created_at || "").slice(0, 19)));
  }).join("");
}

function renderStatus(st) {
  var keys = [["nodes", "nodes"], ["memories", "memories"], ["edges", "edges"], ["paths", "paths"], ["triggers", "triggers"], ["audit", "audit"], ["fts", "fts docs"], ["snapshots", "snapshots"]];
  var cards = keys.map(function (k) { return '<div class="stat"><div class="v">' + esc(String(st[k[0]] ?? 0)) + '</div><div class="l">' + k[1] + '</div></div>'; }).join("");
  OUT.innerHTML = '<div class="stats">' + cards + '</div>' + (st.last_snapshot ? '<div class="hint" style="margin-top:12px">last snapshot: ' + esc(st.last_snapshot) + '</div>' : '');
}

function setSection(t) { SECTION.textContent = t; }

function setView(v) {
  ACTIVE = v;
  NAV.forEach(function (n) { n.className = "nav-item" + (n.getAttribute("data-view") === v ? " active" : ""); });
  skeleton();
  if (v === "overview") { setSection("overview"); if (BOOT !== null) renderBoot(BOOT); else api("/admin/boot").then(function (d) { BOOT = d.text; renderBoot(BOOT); }).catch(fail); }
  else if (v === "all") { setSection("all memories"); api("/admin/all").then(function (d) { renderEntries(d.entries); }).catch(fail); }
  else if (v === "recent") { setSection("recent"); api("/admin/recent").then(function (d) { renderEntries(d.items); }).catch(fail); }
  else if (v === "audit") { setSection("audit trail"); api("/admin/audit").then(function (d) { renderAudit(d.entries); }).catch(fail); }
  else if (v === "status") { setSection("status"); api("/admin/status").then(renderStatus).catch(fail); }
}
function fail(e) { OUT.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; }

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
  setView("overview");
}

NAV.forEach(function (n) { n.addEventListener("click", function () { setView(n.getAttribute("data-view")); }); });
document.getElementById("go").addEventListener("click", doSearch);
Q.addEventListener("keydown", function (e) { if (e.key === "Enter") doSearch(); });

if (MODE === "bearer") {
  var tokGo = document.getElementById("tokGo");
  if (tokGo) tokGo.addEventListener("click", unlock);
  var tokInp = document.getElementById("tok");
  if (tokInp) tokInp.addEventListener("keydown", function (e) { if (e.key === "Enter") unlock(); });
  if (TOK) { setView("overview"); }
}
</script>
</body>
</html>`;
