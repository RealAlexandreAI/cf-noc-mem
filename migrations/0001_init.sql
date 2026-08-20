-- cf-noc-mem D1 schema (SQLite)
-- Single-user memory graph: nodes + versioned memories + edges + paths + FTS5 search + audit.

CREATE TABLE IF NOT EXISTS nodes (
  uuid            TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TEXT
);

-- A content version of a node. Version chain: old.migrated_to -> new.id.
-- Updating a memory inserts a new row and deprecates the old one.
CREATE TABLE IF NOT EXISTS memories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  node_uuid   TEXT NOT NULL REFERENCES nodes(uuid),
  content     TEXT NOT NULL,
  deprecated  INTEGER NOT NULL DEFAULT 0,
  migrated_to INTEGER,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_memories_node ON memories(node_uuid);

-- Directed parent -> child relationship. One edge per structural pair.
CREATE TABLE IF NOT EXISTS edges (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_uuid  TEXT NOT NULL REFERENCES nodes(uuid),
  child_uuid   TEXT NOT NULL REFERENCES nodes(uuid),
  name         TEXT NOT NULL,
  priority     INTEGER NOT NULL DEFAULT 0,
  disclosure   TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(parent_uuid, child_uuid)
);
CREATE INDEX IF NOT EXISTS idx_edges_child ON edges(child_uuid);

-- Materialized URI routing cache: (domain, path) -> edge/node. Aliases are extra rows.
CREATE TABLE IF NOT EXISTS paths (
  domain     TEXT NOT NULL DEFAULT 'core',
  path       TEXT NOT NULL,
  edge_id    INTEGER REFERENCES edges(id),
  node_uuid  TEXT REFERENCES nodes(uuid),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (domain, path)
);
CREATE INDEX IF NOT EXISTS idx_paths_node ON paths(node_uuid);

-- Derived search document per reachable path of an active memory.
CREATE TABLE IF NOT EXISTS search_documents (
  domain      TEXT NOT NULL DEFAULT 'core',
  path        TEXT NOT NULL,
  node_uuid   TEXT NOT NULL REFERENCES nodes(uuid) ON DELETE CASCADE,
  memory_id   INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  uri         TEXT NOT NULL,
  content     TEXT NOT NULL,
  disclosure  TEXT,
  priority    INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (domain, path)
);
CREATE INDEX IF NOT EXISTS idx_search_documents_node ON search_documents(node_uuid);

-- FTS5 trigram index over searchable text. CJK-friendly 3-char window tokenizer.
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  uri, content, disclosure, search_terms,
  tokenize = 'trigram'
);

-- Trigger keywords: keyword -> node binding surfaced by manage_triggers.
CREATE TABLE IF NOT EXISTS triggers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword     TEXT NOT NULL,
  node_uuid   TEXT NOT NULL REFERENCES nodes(uuid) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(keyword, node_uuid)
);
CREATE INDEX IF NOT EXISTS idx_triggers_keyword ON triggers(keyword);

-- Access log for read frequency / recency ordering.
CREATE TABLE IF NOT EXISTS memory_access_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  node_uuid   TEXT NOT NULL REFERENCES nodes(uuid) ON DELETE CASCADE,
  accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  context     TEXT
);
CREATE INDEX IF NOT EXISTS idx_access_node ON memory_access_logs(node_uuid);

-- Audit log for review + rollback. One row per write op with before/after JSON.
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  op          TEXT NOT NULL,          -- create | update | delete | alias
  node_uuid   TEXT,
  uri         TEXT,
  before_json TEXT,                   -- serialized rows prior to mutation
  after_json  TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_node ON audit_logs(node_uuid);

-- Sentinel root node: parent of all top-level edges.
INSERT OR IGNORE INTO nodes (uuid, created_at) VALUES ('00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP);
