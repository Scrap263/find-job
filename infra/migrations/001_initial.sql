CREATE TABLE IF NOT EXISTS job_sources (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO job_sources (code, name)
VALUES
  ('jobicy', 'Jobicy'),
  ('arbeitnow', 'Arbeitnow'),
  ('greenhouse', 'Greenhouse'),
  ('lever', 'Lever')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS source_sync_runs (
  id TEXT PRIMARY KEY,
  source_code TEXT NOT NULL REFERENCES job_sources(code),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  query JSONB NOT NULL DEFAULT '{}'::JSONB,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  upserted_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS source_sync_runs_source_started_idx
  ON source_sync_runs (source_code, started_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  source_code TEXT NOT NULL REFERENCES job_sources(code),
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT NOT NULL,
  workplace_type TEXT NOT NULL CHECK (workplace_type IN ('remote', 'hybrid', 'onsite')),
  salary_min INTEGER,
  salary_max INTEGER,
  salary_currency TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  apply_url TEXT NOT NULL,
  match_score INTEGER NOT NULL DEFAULT 0 CHECK (match_score BETWEEN 0 AND 100),
  matched_skills JSONB NOT NULL DEFAULT '[]'::JSONB,
  missing_skills JSONB NOT NULL DEFAULT '[]'::JSONB,
  match_reason TEXT NOT NULL DEFAULT '',
  raw_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_code, external_id)
);

CREATE INDEX IF NOT EXISTS jobs_match_score_idx
  ON jobs (match_score DESC);

CREATE INDEX IF NOT EXISTS jobs_published_at_idx
  ON jobs (published_at DESC);

CREATE INDEX IF NOT EXISTS jobs_source_status_idx
  ON jobs (source_code, status);
