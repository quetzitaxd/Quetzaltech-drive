CREATE TABLE personal_account (
 id INTEGER PRIMARY KEY CHECK(id = 1), password_hash TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE auth_rate_limits (
 key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, resets_at INTEGER NOT NULL
);
CREATE INDEX auth_rate_limits_expiry ON auth_rate_limits(resets_at);
CREATE INDEX sessions_expiry ON sessions(expires_at);
