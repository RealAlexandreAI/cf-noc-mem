// Read-only memory browser. Linear-style dark, single file, no deps.
// Server renders mode banner + boot data; JS handles only search interaction.
// Placeholders (replaced by worker on each request):
//   __AUTH_MODE__   "access" | "bearer"
//   __STATUS_TEXT__ "access verified" | "bearer required"
//   __STATUS_CLASS__ " ok" | ""
//   __AUTH_ZONE_HTML__  pre-rendered banner or token form
//   __BOOT_DATA__   JSON-encoded boot text (or "null"), placed inside a
//                   type="application/json" script tag so HTML/JS parsers
//                   don't interfere with each other.
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
  .shell { display: grid; grid-template-columns: 260px 1fr; min-height: 100dvh; }
  aside {
    border-right: 1px solid var(--border);
    padding: 28px 22px;
    display: flex;
    flex-direction: column;
    gap: 20px;
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
  main { padding: 28px 32px; max-width: 900px; }
  .search-row { display: flex; gap: 10px; margin-bottom: 22px; }
  .search-row input {
    flex: 1; background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 14px; font-size: 14px; outline: none;
    transition: border-color 0.15s;
  }
  .search-row input:focus { border-color: var(--accent); }
  .section-label { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; }
  .items { display: flex; flex-direction: column; }
  .item {
    padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--panel); margin-bottom: 10px;
    transition: border-color 0.15s, background 0.15s;
  }
  .item:hover { border-color: var(--border-2); background: var(--panel-2); }
  .item .uri { font-family: var(--mono); font-size: 12px; color: var(--accent-2); margin-bottom: 6px; word-break: break-all; }
  .item .body { font-size: 13px; color: var(--text-2); white-space: pre-wrap; word-break: break-word; }
  .item .meta { font-size: 11px; color: var(--text-3); margin-top: 8px; font-family: var(--mono); }
  .skel { border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; margin-bottom: 10px; }
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
  @media (max-width: 768px) {
    .shell { grid-template-columns: 1fr; }
    aside { border-right: 0; border-bottom: 1px solid var(--border); padding: 18px; }
    main { padding: 20px; }
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
    <div id="authZone">__AUTH_ZONE_HTML__</div>
    <div class="hint">boot memories and full-text search. data stays in D1.</div>
  </aside>
  <main>
    <div class="search-row">
      <input id="q" placeholder="search memories" autocomplete="off" spellcheck="false">
      <button class="btn" id="go">Search</button>
    </div>
    <div class="section-label" id="sectionLabel">boot</div>
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
var BOOT_RAW = document.getElementById("bd").textContent;
var BOOT = BOOT_RAW === "null" ? null : JSON.parse(BOOT_RAW);
if (BOOT !== null) renderBoot(BOOT);
else skeleton();

function authHeaders() {
  var h = {};
  if (MODE === "bearer" && TOK) h["Authorization"] = "Bearer " + TOK;
  return h;
}

function api(path) {
  return fetch(path, { headers: authHeaders() }).then(function (r) {
    if (r.status === 401) throw new Error("unauthorized");
    return r.json();
  });
}

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function renderBoot(text) {
  var blocks = text.split(/\n{2,}/).filter(Boolean);
  if (!blocks.length) { OUT.innerHTML = '<div class="empty">no memories yet. write via MCP: create_memory(core://agent, ...)</div>'; return; }
  OUT.innerHTML = blocks.map(function (b) {
    var m = b.match(/^([a-z]+:\\/\\/[^\n]+)\n?([\\s\\S]*)$/);
    if (m) return '<div class="item"><div class="uri">' + esc(m[1]) + '</div><div class="body">' + esc(m[2].trim()) + '</div></div>';
    return '<div class="item"><div class="body">' + esc(b.trim()) + '</div></div>';
  }).join("");
}

function renderSearch(hits) {
  if (!hits || !hits.length) { OUT.innerHTML = '<div class="empty">no results</div>'; return; }
  OUT.innerHTML = hits.map(function (h) {
    return '<div class="item"><div class="uri">' + esc(h.uri) + '</div><div class="body">' + esc(h.snippet || "") + '</div><div class="meta">p' + (h.priority || 0) + '</div></div>';
  }).join("");
}

function skeleton() {
  OUT.innerHTML = '<div class="skel"><div class="line" style="width:40%"></div><div class="line" style="width:90%"></div><div class="line" style="width:70%"></div></div>' +
    '<div class="skel"><div class="line" style="width:55%"></div><div class="line" style="width:85%"></div></div>';
}

function doSearch() {
  var q = Q.value.trim();
  if (!q) { renderBoot(BOOT || "(empty)"); SECTION.textContent = "boot"; return; }
  skeleton(); SECTION.textContent = "search: " + q;
  api("/admin/search?q=" + encodeURIComponent(q)).then(renderSearch).catch(function (e) { OUT.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; });
}

function unlock() {
  TOK = document.getElementById("tok").value.trim();
  localStorage.setItem("nm-token", TOK);
  skeleton(); SECTION.textContent = "boot";
  api("/admin/boot").then(function (d) { BOOT = d.text; renderBoot(BOOT); }).catch(function () { OUT.innerHTML = '<div class="err">token rejected</div>'; });
}

if (MODE === "bearer") {
  document.getElementById("go").addEventListener("click", doSearch);
  Q.addEventListener("keydown", function (e) { if (e.key === "Enter") doSearch(); });
  var tokGo = document.getElementById("tokGo");
  if (tokGo) tokGo.addEventListener("click", unlock);
  var tokInp = document.getElementById("tok");
  if (tokInp) tokInp.addEventListener("keydown", function (e) { if (e.key === "Enter") unlock(); });
  if (TOK) unlock();
} else {
  document.getElementById("go").addEventListener("click", doSearch);
  Q.addEventListener("keydown", function (e) { if (e.key === "Enter") doSearch(); });
}
</script>
</body>
</html>`;
