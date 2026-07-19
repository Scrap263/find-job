import {
  expandRoleTitles,
  filterJobs,
  sampleJobs,
  type Job,
  type JobRegion,
  type JobSource,
  type WorkplaceType
} from "@find-job/domain";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";
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
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": webOrigin,
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_768) throw new Error("Request body is too large");
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function isJobRegion(value: unknown): value is JobRegion {
  return value === "europe" || value === "latam" || value === "apac";
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

    if (request.method === "OPTIONS") {
      sendJson(response, 204, null);
      return;
    }

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

    if (request.method === "POST" && requestUrl.pathname === "/v1/search") {
      const body = await readJsonBody(request);

      if (!body || typeof body !== "object") {
        sendJson(response, 400, {
          error: "invalid_profile",
          message: "Search profile must be a JSON object"
        });
        return;
      }

      const candidate = body as Record<string, unknown>;
      const role =
        typeof candidate.role === "string" ? candidate.role.trim() : "";
      const customAliases = Array.isArray(candidate.aliases)
        ? candidate.aliases.filter(
            (alias): alias is string => typeof alias === "string"
          )
        : [];
      const requestedRegions = Array.isArray(candidate.regions)
        ? candidate.regions.filter(isJobRegion)
        : [];
      const regions: JobRegion[] =
        requestedRegions.length > 0
          ? [...new Set(requestedRegions)]
          : ["europe", "latam", "apac"];

      if (role.length < 2) {
        sendJson(response, 400, {
          error: "invalid_profile",
          message: "Role must contain at least two characters"
        });
        return;
      }

      const titles = expandRoleTitles(role, customAliases).slice(0, 6);
      const jobicy = new JobicyConnector();
      const arbeitnow = new ArbeitnowConnector();
      const searches: Array<
        Promise<{
          source: JobSource;
          query: string;
          region?: JobRegion;
          fetched: number;
        }>
      > = [];

      for (const region of regions) {
        for (const title of titles.slice(0, 3)) {
          searches.push(
            executeSync(
              repository,
              "jobicy",
              { text: title, region, count: 20 },
              () =>
                jobicy.search({
                  text: title,
                  region,
                  count: 20,
                  matchContext: { role, aliases: titles.slice(1) }
                })
            ).then((result) => ({
              source: "jobicy",
              query: title,
              region,
              fetched: result.data.fetched
            }))
          );
        }
      }

      if (regions.includes("europe")) {
        searches.push(
          executeSync(
            repository,
            "arbeitnow",
            { text: role, aliases: titles.slice(1), page: 1 },
            () =>
              arbeitnow.search({
                text: role,
                aliases: titles.slice(1),
                page: 1,
                matchContext: { role, aliases: titles.slice(1) }
              })
          ).then((result) => ({
            source: "arbeitnow",
            query: role,
            fetched: result.data.fetched
          }))
        );
      }

      const settled = await Promise.allSettled(searches);
      const completed = settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      );
      const failed = settled.length - completed.length;

      if (completed.length === 0) {
        sendJson(response, 502, {
          error: "search_failed",
          message: "All international sources failed"
        });
        return;
      }

      sendJson(response, 200, {
        data: {
          profile: { role, aliases: titles.slice(1), regions },
          fetched: completed.reduce(
            (total, result) => total + result.fetched,
            0
          ),
          searches: completed.length,
          failed
        },
        meta: {
          sources: [...new Set(completed.map((result) => result.source))],
          queries: completed
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
