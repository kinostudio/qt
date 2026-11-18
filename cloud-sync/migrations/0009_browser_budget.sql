-- Independent service quota only; never changes project, clause or stamp data.
CREATE TABLE quote_browser_budget (
  id INTEGER PRIMARY KEY CHECK(id=1),
  day TEXT NOT NULL,
  used_ms INTEGER NOT NULL CHECK(used_ms>=0),
  next_start_at INTEGER NOT NULL,
  lease_id TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
