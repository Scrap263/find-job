import type { Job, JobFilters, JobSource, WorkplaceType } from "@find-job/domain";
import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { type Database, withTransaction } from "./database.js";

type JobRow = QueryResultRow & {
  id: string;
  source_code: JobSource;
  external_id: string;
  title: string;
  company: string;
  location: string;
  workplace_type: WorkplaceType;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: "RUB" | "USD" | "EUR" | null;
  published_at: Date;
  apply_url: string;
  match_score: number;
  matched_skills: string[];
  missing_skills: string[];
  match_reason: string;
};

export type JobUpsert = Job & {
  externalId: string;
  rawPayload: unknown;
};

export type SyncRun = {
  id: string;
  source: JobSource;
};

function mapJobRow(row: JobRow): Job {
  const salary =
    row.salary_min !== null &&
    row.salary_max !== null &&
    row.salary_currency !== null
      ? {
          min: row.salary_min,
          max: row.salary_max,
          currency: row.salary_currency
        }
      : undefined;

  return {
    id: row.id,
    title: row.title,
    company: row.company,
    location: row.location,
    workplaceType: row.workplace_type,
    ...(salary ? { salary } : {}),
    publishedAt: row.published_at.toISOString(),
    source: row.source_code,
    applyUrl: row.apply_url,
    match: {
      score: row.match_score,
      matchedSkills: row.matched_skills,
      missingSkills: row.missing_skills,
      reason: row.match_reason
    }
  };
}

export class JobRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  async ping() {
    await this.database.pool.query("SELECT 1");
  }

  async list(filters: JobFilters): Promise<Job[]> {
    const values: unknown[] = [filters.minScore];
    const clauses = ["status = 'active'", "match_score >= $1"];

    if (filters.workplace !== "all") {
      values.push(filters.workplace);
      clauses.push(`workplace_type = $${values.length}`);
    }

    if (filters.query.trim()) {
      values.push(`%${filters.query.trim()}%`);
      clauses.push(
        `(title ILIKE $${values.length} OR company ILIKE $${values.length} OR location ILIKE $${values.length})`
      );
    }

    const result = await this.database.pool.query<JobRow>(
      `SELECT *
       FROM jobs
       WHERE ${clauses.join(" AND ")}
       ORDER BY match_score DESC, published_at DESC
       LIMIT 100`,
      values
    );

    return result.rows.map(mapJobRow);
  }

  async startSync(
    source: JobSource,
    query: Record<string, unknown>
  ): Promise<SyncRun> {
    const run = { id: randomUUID(), source };

    await this.database.pool.query(
      `INSERT INTO source_sync_runs (id, source_code, status, query)
       VALUES ($1, $2, 'running', $3::JSONB)`,
      [run.id, source, JSON.stringify(query)]
    );

    return run;
  }

  async completeSync(
    run: SyncRun,
    result: {
      status: "completed" | "partial" | "failed";
      fetched: number;
      upserted: number;
      error?: string;
    }
  ) {
    await this.database.pool.query(
      `UPDATE source_sync_runs
       SET status = $2,
           fetched_count = $3,
           upserted_count = $4,
           error_message = $5,
           finished_at = NOW()
       WHERE id = $1`,
      [
        run.id,
        result.status,
        result.fetched,
        result.upserted,
        result.error ?? null
      ]
    );
  }

  async upsertMany(jobs: JobUpsert[]): Promise<number> {
    if (jobs.length === 0) return 0;

    return withTransaction(this.database, async (client) => {
      let upserted = 0;

      for (const job of jobs) {
        await this.upsertOne(client, job);
        upserted += 1;
      }

      return upserted;
    });
  }

  private async upsertOne(client: PoolClient, job: JobUpsert) {
    await client.query(
      `INSERT INTO jobs (
         id, source_code, external_id, title, company, location,
         workplace_type, salary_min, salary_max, salary_currency,
         published_at, apply_url, match_score, matched_skills,
         missing_skills, match_reason, raw_payload
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10,
         $11, $12, $13, $14::JSONB,
         $15::JSONB, $16, $17::JSONB
       )
       ON CONFLICT (source_code, external_id) DO UPDATE SET
         title = EXCLUDED.title,
         company = EXCLUDED.company,
         location = EXCLUDED.location,
         workplace_type = EXCLUDED.workplace_type,
         salary_min = EXCLUDED.salary_min,
         salary_max = EXCLUDED.salary_max,
         salary_currency = EXCLUDED.salary_currency,
         published_at = EXCLUDED.published_at,
         apply_url = EXCLUDED.apply_url,
         match_score = EXCLUDED.match_score,
         matched_skills = EXCLUDED.matched_skills,
         missing_skills = EXCLUDED.missing_skills,
         match_reason = EXCLUDED.match_reason,
         raw_payload = EXCLUDED.raw_payload,
         status = 'active',
         last_seen_at = NOW(),
         updated_at = NOW()`,
      [
        job.id,
        job.source,
        job.externalId,
        job.title,
        job.company,
        job.location,
        job.workplaceType,
        job.salary?.min ?? null,
        job.salary?.max ?? null,
        job.salary?.currency ?? null,
        job.publishedAt,
        job.applyUrl,
        job.match.score,
        JSON.stringify(job.match.matchedSkills),
        JSON.stringify(job.match.missingSkills),
        job.match.reason,
        JSON.stringify(job.rawPayload)
      ]
    );
  }
}
