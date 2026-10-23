export const initialMigration = {
  version: 1,
  name: 'init',
  sql: `
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
) STRICT;

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  media_type TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE targets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL, format TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('file','directory','url')),
  source_key TEXT NOT NULL,                 -- normalized absolute path or URL: identity for supersession
  intake_mode TEXT NOT NULL CHECK (intake_mode IN ('snapshot','reference')),
  digest_algorithm TEXT CHECK (digest_algorithm IN ('sha256','phoenix-tree-sha256-v1')),
  digest TEXT,
  artifact_id TEXT REFERENCES artifacts(id),
  inventory_artifact_id TEXT REFERENCES artifacts(id),
  supersedes_id TEXT REFERENCES targets(id),
  manifest_json TEXT NOT NULL,              -- full TargetManifest (validated on read)
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX targets_project ON targets(project_id, created_at);
CREATE INDEX targets_source ON targets(project_id, source_key, created_at);
CREATE INDEX targets_digest ON targets(digest);
CREATE INDEX targets_artifact ON targets(artifact_id);
CREATE INDEX targets_inventory_artifact ON targets(inventory_artifact_id);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  target_id TEXT NOT NULL REFERENCES targets(id),
  candidate_target_id TEXT REFERENCES targets(id),
  based_on_job_id TEXT REFERENCES jobs(id),
  mode TEXT NOT NULL CHECK (mode IN ('investigate','reconstruct','verify')),
  objective TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('created','fingerprinting','ready','planning','investigating',
                       'reconstructing','verifying','completed','partial','failed','cancelled')),
  version INTEGER NOT NULL DEFAULT 0,
  budget_json TEXT NOT NULL, policy_json TEXT NOT NULL,
  host_json TEXT, error_json TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT,
  CHECK ((mode = 'verify') = (candidate_target_id IS NOT NULL))
) STRICT;
CREATE INDEX jobs_project ON jobs(project_id, created_at);
CREATE INDEX jobs_state ON jobs(state);
CREATE INDEX jobs_target ON jobs(target_id);
CREATE INDEX jobs_candidate_target ON jobs(candidate_target_id);

CREATE TABLE job_steps (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  step_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL,
  lease_owner TEXT, lease_expires_at TEXT,
  output_json TEXT, error_json TEXT,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  UNIQUE (job_id, step_key)
) STRICT;

CREATE TABLE job_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,    -- global monotonic order; SSE id
  id TEXT NOT NULL UNIQUE,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE INDEX job_events_job ON job_events(job_id, seq);

CREATE TABLE tool_invocations (
  request_id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id), step_id TEXT REFERENCES job_steps(id),
  target_id TEXT NOT NULL REFERENCES targets(id),
  operation TEXT NOT NULL, provider_id TEXT, provider_version TEXT,
  params_json TEXT NOT NULL, cache_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok','partial','error')),
  error_code TEXT, duration_ms INTEGER NOT NULL,
  envelope_json TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE INDEX tool_invocations_job ON tool_invocations(job_id);
CREATE INDEX tool_invocations_cache ON tool_invocations(cache_key) WHERE status = 'ok';

CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES targets(id),
  job_id TEXT REFERENCES jobs(id),
  request_id TEXT REFERENCES tool_invocations(request_id),
  producer_json TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('static','runtime','user','derived')),
  type TEXT NOT NULL,
  data_json TEXT, data_artifact_id TEXT REFERENCES artifacts(id),
  target_digest TEXT, created_at TEXT NOT NULL,
  CHECK (data_json IS NOT NULL OR data_artifact_id IS NOT NULL)
) STRICT;
CREATE INDEX observations_target ON observations(target_id, created_at);
CREATE INDEX observations_job ON observations(job_id);
CREATE INDEX observations_data_artifact ON observations(data_artifact_id);

CREATE TABLE evidence_refs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('static','runtime','user','derived')),
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  observation_id TEXT REFERENCES observations(id),
  location TEXT, locator_json TEXT, created_at TEXT NOT NULL
) STRICT;

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES targets(id),
  job_id TEXT REFERENCES jobs(id),
  current_revision INTEGER NOT NULL CHECK (current_revision >= 1),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE finding_revisions (
  finding_id TEXT NOT NULL REFERENCES findings(id),
  revision INTEGER NOT NULL,
  statement TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('hypothesis','observed','corroborated','contradicted')),
  limitations_json TEXT NOT NULL, author_json TEXT NOT NULL, reason TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (finding_id, revision)
) STRICT;
CREATE TABLE finding_evidence (
  finding_id TEXT NOT NULL, revision INTEGER NOT NULL,
  evidence_ref_id TEXT NOT NULL REFERENCES evidence_refs(id),
  PRIMARY KEY (finding_id, revision, evidence_ref_id),
  FOREIGN KEY (finding_id, revision) REFERENCES finding_revisions(finding_id, revision)
) STRICT;

CREATE TABLE relations (
  id TEXT PRIMARY KEY,
  from_type TEXT NOT NULL, from_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('calls','imports','derived_from','supports','contradicts',
                          'produced_by','tests','implements','observed_in','supersedes')),
  to_type TEXT NOT NULL, to_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (from_type, from_id, relation, to_type, to_id)
) STRICT;

-- Append-only enforcement for history tables
CREATE TRIGGER job_events_no_update BEFORE UPDATE ON job_events BEGIN SELECT RAISE(ABORT, 'job_events is append-only'); END;
CREATE TRIGGER job_events_no_delete BEFORE DELETE ON job_events BEGIN SELECT RAISE(ABORT, 'job_events is append-only'); END;
CREATE TRIGGER finding_revisions_no_update BEFORE UPDATE ON finding_revisions BEGIN SELECT RAISE(ABORT, 'finding_revisions is append-only'); END;
CREATE TRIGGER observations_no_update BEFORE UPDATE ON observations BEGIN SELECT RAISE(ABORT, 'observations are immutable'); END;

CREATE TRIGGER finding_revisions_no_delete BEFORE DELETE ON finding_revisions BEGIN SELECT RAISE(ABORT, 'finding_revisions is append-only'); END;
CREATE TRIGGER observations_no_delete BEFORE DELETE ON observations BEGIN SELECT RAISE(ABORT, 'observations are immutable'); END;
CREATE TRIGGER targets_no_update BEFORE UPDATE ON targets BEGIN SELECT RAISE(ABORT, 'targets is immutable'); END;
CREATE TRIGGER targets_no_delete BEFORE DELETE ON targets BEGIN SELECT RAISE(ABORT, 'targets is immutable'); END;
CREATE TRIGGER artifacts_no_update BEFORE UPDATE ON artifacts BEGIN SELECT RAISE(ABORT, 'artifacts is immutable'); END;
CREATE TRIGGER artifacts_no_delete BEFORE DELETE ON artifacts BEGIN SELECT RAISE(ABORT, 'artifacts is immutable'); END;
CREATE TRIGGER evidence_refs_no_update BEFORE UPDATE ON evidence_refs BEGIN SELECT RAISE(ABORT, 'evidence_refs is immutable'); END;
CREATE TRIGGER evidence_refs_no_delete BEFORE DELETE ON evidence_refs BEGIN SELECT RAISE(ABORT, 'evidence_refs is immutable'); END;
CREATE TRIGGER finding_evidence_no_update BEFORE UPDATE ON finding_evidence BEGIN SELECT RAISE(ABORT, 'finding_evidence is immutable'); END;
CREATE TRIGGER finding_evidence_no_delete BEFORE DELETE ON finding_evidence BEGIN SELECT RAISE(ABORT, 'finding_evidence is immutable'); END;
CREATE TRIGGER relations_no_update BEFORE UPDATE ON relations BEGIN SELECT RAISE(ABORT, 'relations is immutable'); END;
CREATE TRIGGER relations_no_delete BEFORE DELETE ON relations BEGIN SELECT RAISE(ABORT, 'relations is immutable'); END;
`,
} as const;
