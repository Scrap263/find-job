import {
  filterJobs,
  sampleJobs,
  type Job,
  type JobSource,
  type WorkplaceType
} from "@find-job/domain";
import { createServer, type ServerResponse } from "node:http";
import { ArbeitnowConnector } from "./connectors/arbeitnow.js";
import { JobicyConnector, type JobicyRegion } from "./connectors/jobicy.js";
import { createDatabase } from "./database.js";
import {
  JobRepository,
  type JobUpsert
} from "./job-repository.js";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "127.0.0.1";
const webOrigin = process.env.WEB_ORIGIN ?? "*";
const database = createDatabase();
let repository = database ? new JobRepository(database) : null;
let memoryJobs = [...sampleJobs];

if (repository) {
  try {
    await repository.ping();
    console.log("PostgreSQL connection established.");
  } catch (error) {
    console.warn(
      "PostgreSQL is unavailable; using in-memory job storage.",
      error
    );
    await database?.close();
    repository = null;
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": webOrigin,
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function parseJobFilters(requestUrl: URL) {
  const workplaceParam = requestUrl.searchParams.get("workplace");
  const workplace: WorkplaceType | "all" =
    workplaceParam === "remote" ||
    workplaceParam === "hybrid" ||
    workplaceParam === "onsite"
      ? workplaceParam
      : "all";
  const minScoreParam = Number(requestUrl.searchParams.get("minScore") ?? 0);

  return {
    query: requestUrl.searchParams.get("q") ?? "",
    workplace,
    minScore: Number.isFinite(minScoreParam) ? minScoreParam : 0
  };
}

async function executeSync(
  jobRepository: JobRepository | null,
  source: JobSource,
  query: Record<string, unknown>,
  loader: () => Promise<{ jobs: JobUpsert[]; meta: Record<string, unknown> }>
) {
  if (!jobRepository) {
    const result = await loader();
    const mergedJobs = new Map(memoryJobs.map((job) => [job.id, job]));

    for (const job of result.jobs) {
      const canonicalJob: Job = {
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        workplaceType: job.workplaceType,
        ...(job.salary ? { salary: job.salary } : {}),
        publishedAt: job.publishedAt,
        source: job.source,
        applyUrl: job.applyUrl,
        match: job.match
      };
      mergedJobs.set(canonicalJob.id, canonicalJob);
    }

    memoryJobs = [...mergedJobs.values()];

    return {
      data: {
        runId: null,
        fetched: result.jobs.length,
        upserted: result.jobs.length,
        storage: "memory"
      },
      meta: result.meta
    };
  }

  const run = await jobRepository.startSync(source, query);

  try {
    const result = await loader();
    const upserted = await jobRepository.upsertMany(result.jobs);
    await jobRepository.completeSync(run, {
      status: "completed",
      fetched: result.jobs.length,
      upserted
    });

    return {
      data: {
        runId: run.id,
        fetched: result.jobs.length,
        upserted
      },
      meta: result.meta
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown sync error";
    await jobRepository.completeSync(run, {
      status: "failed",
      fetched: 0,
      upserted: 0,
      error: message
    });
    throw error;
  }
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(
      request.url ?? "/",
      `http://${request.headers.host}`
    );

    if (request.method === "GET" && requestUrl.pathname === "/health") {
      sendJson(response, 200, {
        status: "ok",
        service: "find-job-api",
        database: repository ? "connected" : "memory",
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/v1/sources") {
      sendJson(response, 200, {
        data: [
          {
            code: "jobicy",
            name: "Jobicy",
            regions: ["europe", "latam", "apac", "anywhere"],
            configured: true,
            databaseRequired: false
          },
          {
            code: "arbeitnow",
            name: "Arbeitnow",
            regions: ["europe"],
            configured: true,
            databaseRequired: false
          }
        ],
        meta: {
          database: repository ? "connected" : "memory"
        }
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/v1/jobs") {
      const filters = parseJobFilters(requestUrl);
      const jobs = repository
        ? await repository.list(filters)
        : filterJobs(memoryJobs, filters);

      sendJson(response, 200, {
        data: jobs,
        meta: {
          count: jobs.length,
          sources: [...new Set(jobs.map((job) => job.source))],
          storage: repository ? "postgres" : "memory",
          generatedAt: new Date().toISOString()
        }
      });
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/v1/sync/jobicy"
    ) {
      const regionParam = requestUrl.searchParams.get("region");
      const region: JobicyRegion =
        regionParam === "europe" ||
        regionParam === "latam" ||
        regionParam === "apac"
          ? regionParam
          : "anywhere";
      const query = {
        text: requestUrl.searchParams.get("text") ?? "Product Analyst",
        region,
        count: Math.min(
          100,
          Math.max(
            1,
            Number(requestUrl.searchParams.get("count") ?? 50) || 50
          )
        )
      };
      const connector = new JobicyConnector();

      try {
        const result = await executeSync(
          repository,
          "jobicy",
          query,
          () => connector.search(query)
        );
        sendJson(response, 200, result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown sync error";
        sendJson(response, 502, {
          error: "jobicy_sync_failed",
          message
        });
      }
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/v1/sync/arbeitnow"
    ) {
      const query = {
        text: requestUrl.searchParams.get("text") ?? "Product Analyst",
        page: Math.max(
          1,
          Number(requestUrl.searchParams.get("page") ?? 1) || 1
        )
      };
      const connector = new ArbeitnowConnector();

      try {
        const result = await executeSync(
          repository,
          "arbeitnow",
          query,
          () => connector.search(query)
        );
        sendJson(response, 200, result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown sync error";
        sendJson(response, 502, {
          error: "arbeitnow_sync_failed",
          message
        });
      }
      return;
    }

    sendJson(response, 404, {
      error: "not_found",
      message: "Route not found"
    });
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, 500, {
        error: "internal_error",
        message: "Unable to process request"
      });
    } else {
      response.end();
    }
  }
});

server.listen(port, host, () => {
  console.log(`Find Job API listening on http://${host}:${port}`);
});
