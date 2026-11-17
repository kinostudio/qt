-- Additive only: existing workspaces, projects, clauses and stamps are untouched.
CREATE TABLE quote_signing_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64),
  snapshot_key TEXT NOT NULL UNIQUE,
  snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256) = 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at > created_at),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','submitting','signed')),
  revoked_at INTEGER,
  submission_key TEXT,
  submission_sha256 TEXT,
  idempotency_hash TEXT,
  submitted_at INTEGER,
  signed_pdf_key TEXT,
  signed_pdf_sha256 TEXT,
  signed_at INTEGER,
  CHECK (
    (status = 'pending' AND submission_key IS NULL AND submission_sha256 IS NULL AND idempotency_hash IS NULL AND submitted_at IS NULL)
    OR (status IN ('submitting','signed') AND submission_key IS NOT NULL AND submission_sha256 IS NOT NULL AND length(submission_sha256) = 64 AND idempotency_hash IS NOT NULL AND length(idempotency_hash) = 64 AND submitted_at IS NOT NULL)
  ),
  CHECK (
    (status != 'signed' AND signed_pdf_key IS NULL AND signed_pdf_sha256 IS NULL AND signed_at IS NULL)
    OR (status = 'signed' AND signed_pdf_key IS NOT NULL AND signed_pdf_sha256 IS NOT NULL AND length(signed_pdf_sha256) = 64 AND signed_at IS NOT NULL)
  )
);

CREATE INDEX idx_quote_signing_workspace
ON quote_signing_requests(workspace_id, created_at DESC);

CREATE TRIGGER quote_signing_immutable_snapshot
BEFORE UPDATE ON quote_signing_requests
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.token_hash IS NOT OLD.token_hash OR NEW.snapshot_key IS NOT OLD.snapshot_key
  OR NEW.snapshot_sha256 IS NOT OLD.snapshot_sha256
  OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
BEGIN
  SELECT RAISE(ABORT, 'immutable signing snapshot');
END;

CREATE TRIGGER quote_signing_forward_only
BEFORE UPDATE ON quote_signing_requests
WHEN (OLD.status = 'submitting' AND NEW.status NOT IN ('submitting','signed'))
  OR (OLD.status = 'signed' AND NEW.status != 'signed')
  OR (OLD.status = 'pending' AND NEW.status NOT IN ('pending','submitting'))
  OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
  OR (OLD.revoked_at IS NOT NULL AND NEW.status IS NOT OLD.status)
  OR (NEW.status IS NOT OLD.status AND NEW.revoked_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'invalid signing transition');
END;

CREATE TRIGGER quote_signing_immutable_submission
BEFORE UPDATE ON quote_signing_requests
WHEN OLD.status != 'pending' AND (
  NEW.submission_key IS NOT OLD.submission_key OR NEW.submission_sha256 IS NOT OLD.submission_sha256
  OR NEW.idempotency_hash IS NOT OLD.idempotency_hash OR NEW.submitted_at IS NOT OLD.submitted_at
)
BEGIN
  SELECT RAISE(ABORT, 'immutable client submission');
END;

CREATE TRIGGER quote_signing_immutable_pdf
BEFORE UPDATE ON quote_signing_requests
WHEN OLD.status = 'signed' AND (
  NEW.signed_pdf_key IS NOT OLD.signed_pdf_key OR NEW.signed_pdf_sha256 IS NOT OLD.signed_pdf_sha256
  OR NEW.signed_at IS NOT OLD.signed_at
)
BEGIN
  SELECT RAISE(ABORT, 'immutable signed PDF');
END;
