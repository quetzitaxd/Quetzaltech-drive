CREATE TABLE products (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) > 0), code TEXT,
 storage_key TEXT NOT NULL UNIQUE, next_sequence INTEGER NOT NULL DEFAULT 1 CHECK(next_sequence > 0),
 cover_asset_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE assets (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
 original_name TEXT NOT NULL, assigned_name TEXT NOT NULL, relative_path TEXT NOT NULL UNIQUE,
 mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
 sort_order INTEGER NOT NULL DEFAULT 0, thumbnail_path TEXT,
 thumbnail_status TEXT NOT NULL DEFAULT 'pending' CHECK(thumbnail_status IN ('pending','ready','unsupported','failed')),
 created_at TEXT NOT NULL, UNIQUE(product_id, assigned_name)
);
CREATE INDEX assets_product_order ON assets(product_id, sort_order, id);
CREATE INDEX products_name ON products(name);
CREATE INDEX products_code ON products(code);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, csrf_hash TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE devices (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE pairing_codes (
 code_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL, consumed_at TEXT
);
CREATE TABLE upload_attempts (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
 idempotency_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL CHECK(state IN ('receiving','complete','failed')),
 request_fingerprint TEXT NOT NULL, asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
 temp_path TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE jobs (
 id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('thumbnail','poster')),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','complete','failed')),
 attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX jobs_state ON jobs(state, updated_at);
-- cover_asset_id: verificar pertenencia en servicio; evita dependencia circular al crear tablas.
-- No borrar productos con archivos sin operación explícita y recuperación documentada.
