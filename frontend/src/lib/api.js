// Adapter: keep upstream nocturne API surface (function names + response shapes)
// but call cf-noc-mem worker endpoints instead of the original FastAPI backend.
// Auth: Bearer (api_token) for agents, Access (cookie) for browsers; we just
// send Bearer when token is present. Server falls back to Access header check.
const API_TOKEN_KEY = 'api_token';
const NS_KEY = 'selected_namespace';

function token() { return localStorage.getItem(API_TOKEN_KEY) || ''; }
function namespace() { return localStorage.getItem(NS_KEY) || ''; }

async function rpc(method, params) {
  const r = await fetch('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: 'Bearer ' + token() } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: method, arguments: params } }),
  });
  if (r.status === 401) {
    localStorage.removeItem(API_TOKEN_KEY);
    throw new Error('unauthorized');
  }
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'rpc error');
  return d.result?.content?.[0]?.text ?? '';
}

async function getJson(path) {
  const r = await fetch(path, { headers: token() ? { Authorization: 'Bearer ' + token() } : {} });
  if (r.status === 401) { localStorage.removeItem(API_TOKEN_KEY); throw new Error('unauthorized'); }
  return r.json();
}
async function postJson(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: 'Bearer ' + token() } : {}) }, body: JSON.stringify(body) });
  if (r.status === 401) { localStorage.removeItem(API_TOKEN_KEY); throw new Error('unauthorized'); }
  return r.json();
}
async function delJson(path) {
  const r = await fetch(path, { method: 'DELETE', headers: token() ? { Authorization: 'Bearer ' + token() } : {} });
  if (r.status === 401) { localStorage.removeItem(API_TOKEN_KEY); throw new Error('unauthorized'); }
  return r.json();
}

// ============ Review (audit + rollback) ============
export const getGroups = async () => {
  const d = await getJson('/admin/audit');
  return (d.entries || []).map((a) => ({
    node_uuid: String(a.id),
    domain: a.uri ? a.uri.split('://')[0] : 'core',
    path: a.uri ? a.uri.split('://')[1] : '',
    uri: a.uri || '',
    action: a.op,
    timestamp: a.created_at,
    // upstream component reads changes count etc.; surface minimal shape
  }));
};
export const getGroupDiff = async (id) => {
  const d = await getJson('/admin/audit/' + id);
  return d.audit || {};
};
export const rollbackGroup = async (id) => postJson('/admin/audit/' + id + '/rollback', {});
export const approveGroup = async () => { throw new Error('not supported in single-user mode'); };
export const clearAll = async () => { throw new Error('not supported'); };

// ============ Browse (memory) ============
export const getDomains = async () => ['core'];
export const addDomain = async () => { throw new Error('not supported'); };
export const removeDomain = async () => { throw new Error('not supported'); };
export const getNamespaces = async () => {
  const ns = namespace();
  return ns ? [ns] : [''];
};

export const deleteNode = async (domain, path) => {
  const uri = (domain || 'core') + '://' + (path || '').replace(/^\/+/, '');
  await rpc('delete_memory', { uri });
  return { ok: true };
};

export const searchMemories = async (q, opts = {}) => {
  const d = await getJson('/admin/search?q=' + encodeURIComponent(q || ''));
  return d.hits || [];
};

export const createMemory = async (data) => {
  const args = {
    parent_uri: data.parent_uri || (data.domain && data.path ? data.domain + '://' + data.path : 'core://agent'),
    content: data.content || '',
    priority: typeof data.priority === 'number' ? data.priority : 0,
  };
  if (data.disclosure) args.disclosure = data.disclosure;
  const t = await rpc('create_memory', args);
  return { ok: true, text: t };
};

export const addAlias = async (data) => {
  const args = {
    new_uri: data.new_uri,
    target_uri: data.target_uri,
    priority: data.priority ?? 0,
    disclosure: data.disclosure ?? null,
  };
  await rpc('add_alias', args);
  return { ok: true };
};

export const renameNode = async () => { throw new Error('not supported (single-user, fixed schema)'); };

// ============ Settings (mostly trimmed) ============
export const getSettings = async () => ({ trimmed: true });
export const updateSettings = async () => { throw new Error('not supported'); };
export const getSettingsBootUris = async () => [];
export const setSettingsBootUris = async () => { throw new Error('not supported'); };
export const toggleSettingsBootUri = async () => { throw new Error('not supported'); };
export const getAllBootUris = async () => [];
export const setBootUrisForNs = async () => { throw new Error('not supported'); };
export const deleteBootUrisForNs = async () => { throw new Error('not supported'); };

// ============ Presets (trimmed) ============
export const listPresets = async () => [];
export const createPreset = async () => { throw new Error('not supported (trimmed from single-user mode)'); };
export const updatePreset = async () => { throw new Error('not supported'); };
export const deletePreset = async () => { throw new Error('not supported'); };
export const activatePreset = async () => { throw new Error('not supported'); };
export const duplicatePreset = async () => { throw new Error('not supported'); };

// ============ Database settings (trimmed) ============
export const getDatabaseStatus = async () => {
  const d = await getJson('/admin/status');
  return d;
};
export const testDatabase = async () => { throw new Error('not supported'); };
export const createDatabase = async () => { throw new Error('not supported'); };
export const openDbFolder = async () => { throw new Error('not supported'); };

// ============ MCP (system) ============
export const systemBoot = async () => {
  const t = await rpc('read_memory', { uri: 'system://boot' });
  return t;
};
export const systemRecent = async (n = 10) => {
  const t = await rpc('read_memory', { uri: 'system://recent/' + n });
  return t;
};
export const systemIndex = async (domain = 'core') => {
  const t = await rpc('read_memory', { uri: 'system://index/' + domain });
  return t;
};

export default { getJson, postJson, delJson, rpc };

// Compatibility shim for components that still import `api` (axios) directly.
export const api = {
  get: (p) => getJson(p),
  post: (p, b) => postJson(p, b),
  put: (p, b) => postJson(p, b),
  delete: (p) => delJson(p),
  patch: (p, b) => postJson(p, b),
};
export const AUTH_ERROR_EVENT = 'nocturne:auth-error';
