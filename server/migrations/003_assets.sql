ALTER TABLE assets ADD COLUMN sha256 TEXT;

ALTER TABLE upload_attempts RENAME TO upload_attempts_legacy;
CREATE TABLE upload_attempts (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 idempotency_key TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('receiving','complete','failed')),
 request_fingerprint TEXT NOT NULL,
 asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
 temp_path TEXT, updated_at TEXT NOT NULL
);
INSERT INTO upload_attempts(id, product_id, idempotency_key, state, request_fingerprint, asset_id, temp_path, updated_at)
 SELECT id, product_id, idempotency_key, state, request_fingerprint, asset_id, temp_path, updated_at FROM upload_attempts_legacy;
DROP TABLE upload_attempts_legacy;

ALTER TABLE upload_attempts ADD COLUMN original_name TEXT;
ALTER TABLE upload_attempts ADD COLUMN expected_size INTEGER;
ALTER TABLE upload_attempts ADD COLUMN expected_sha256 TEXT;
ALTER TABLE upload_attempts ADD COLUMN reserved_sequence INTEGER;
ALTER TABLE upload_attempts ADD COLUMN pending_asset_id TEXT;
ALTER TABLE upload_attempts ADD COLUMN assigned_name TEXT;
ALTER TABLE upload_attempts ADD COLUMN detected_mime_type TEXT;
ALTER TABLE upload_attempts ADD COLUMN final_relative_path TEXT;
ALTER TABLE upload_attempts ADD COLUMN sort_order INTEGER;
ALTER TABLE upload_attempts ADD COLUMN last_error_code TEXT;
ALTER TABLE upload_attempts ADD COLUMN completed_at TEXT;
ALTER TABLE upload_attempts ADD COLUMN tombstoned_at TEXT;

CREATE TABLE asset_operations (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('rename','move','delete')),
 asset_id TEXT NOT NULL,
 source_relative_path TEXT NOT NULL,
 target_relative_path TEXT NOT NULL,
 target_product_id TEXT,
 target_assigned_name TEXT,
 target_sort_order INTEGER,
 state TEXT NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','fs_done','db_done')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX asset_operations_active_asset ON asset_operations(asset_id)
 WHERE state != 'db_done';
CREATE INDEX upload_attempts_state ON upload_attempts(state, updated_at);
