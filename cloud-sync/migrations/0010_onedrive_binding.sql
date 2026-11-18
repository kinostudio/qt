-- Independent credential tables: intentionally excluded from workspace snapshots/exports.
CREATE TABLE onedrive_bindings (
  workspace_id TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  drive_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_username TEXT NOT NULL,
  refresh_encrypted TEXT NOT NULL,
  folder_json TEXT,
  needs_reconnect INTEGER NOT NULL DEFAULT 0 CHECK (needs_reconnect IN (0, 1)),
  lease_id TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE onedrive_binding_attempts (
  workspace_id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  challenge TEXT NOT NULL,
  base_revision TEXT,
  expires_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed IN (0, 1))
);
