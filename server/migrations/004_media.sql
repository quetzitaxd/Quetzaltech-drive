CREATE TABLE media_tickets (
 token_hash TEXT PRIMARY KEY,
 asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
 scope TEXT NOT NULL CHECK(scope IN ('content','thumbnail','download')),
 principal_kind TEXT NOT NULL CHECK(principal_kind IN ('session','device')),
 principal_key TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX media_tickets_expiry ON media_tickets(expires_at);
CREATE INDEX media_tickets_asset ON media_tickets(asset_id);
CREATE INDEX jobs_asset_state ON jobs(asset_id, state);
ALTER TABLE asset_operations ADD COLUMN thumbnail_relative_path TEXT;
ALTER TABLE assets ADD COLUMN playback_status TEXT NOT NULL DEFAULT 'not_applicable'
 CHECK(playback_status IN ('not_applicable','pending','playable','download_only'));
UPDATE assets SET playback_status = 'pending' WHERE mime_type LIKE 'video/%';
