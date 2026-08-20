export const UI_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cf-noc-mem · memory</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #0d1117; color: #e6edf3; margin: 0; padding: 24px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 16px; }
  .bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  input, button { background: #161b22; color: #e6edf3; border: 1px solid #30363d; border-radius: 8px; padding: 8px 12px; font-size: 14px; }
  input#token { width: 320px; font-family: ui-monospace, monospace; }
  input#q { flex: 1; min-width: 200px; }
  button { cursor: pointer; }
  button:hover { background: #21262d; }
  .mem { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
  .mem .uri { color: #58a6ff; font-family: ui-monospace, monospace; font-size: 12px; margin-bottom: 6px; }
  .mem pre { white-space: pre-wrap; font-size: 13px; margin: 0; line-height: 1.6; }
  .err { color: #f85149; }
  .hint { color: #8b949e; font-size: 12px; margin-bottom: 12px; }
</style>
</head>
<body>
<h1>cf-noc-mem · memory</h1>
<div class="bar">
  <input id="token" placeholder="API token" type="password">
  <button onclick="loadBoot()">加载</button>
  <input id="q" placeholder="搜索记忆…" onkeydown="if(event.key==='Enter')search()">
  <button onclick="search()">搜索</button>
</div>
<div class="hint">只读面板:boot 记忆 + 全文搜索。token 仅存本机 localStorage。</div>
<div id="out"></div>
<script>
const $ = (id) => document.getElementById(id);
const OUT = $('out');
function tok() { const t = $('token').value.trim(); if (t) localStorage.setItem('nm-token', t); return t || localStorage.getItem('nm-token') || ''; }
$('token').value = localStorage.getItem('nm-token') || '';

async function rpc(id, method, name, args) {
  const t = tok();
  if (!t) { OUT.innerHTML = '<div class="err">先填 token</div>'; return null; }
  const r = await fetch('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params: { name, arguments: args } })
  });
  const d = await r.json();
  if (d.error) { OUT.innerHTML = '<div class="err">' + (d.error.message || 'rpc error') + '</div>'; return null; }
  return d.result?.content?.[0]?.text ?? '';
}

function render(text) {
  const blocks = text.split(/\n\n+/);
  OUT.innerHTML = blocks.map(b => {
    const m = b.match(/^([a-z]+:\/\/[^\n]+)\n?([\s\S]*)$/);
    return m ? '<div class="mem"><div class="uri">' + m[1] + '</div><pre>' + m[2] + '</pre></div>'
             : '<div class="mem"><pre>' + b + '</pre></div>';
  }).join('');
}

async function loadBoot() { OUT.innerHTML = '<div class="hint">loading…</div>'; const t = await rpc(1, 'tools/call', 'read_memory', { uri: 'system://boot' }); if (t !== null) render(t); }
async function search() { const q = $('q').value.trim(); if (!q) return; OUT.innerHTML = '<div class="hint">searching…</div>'; const t = await rpc(2, 'tools/call', 'search_memory', { query: q }); if (t !== null) render(t === '(no results)' ? '<div class="hint">no results</div>' : t); }
</script>
</body>
</html>`;
