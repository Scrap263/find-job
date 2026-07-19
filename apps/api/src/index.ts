import {
  expandRoleTitles,
  filterJobs,
  normalizeJobBoardToken,
  sampleJobs,
  type Job,
  type JobBoardConfig,
  type JobBoardProvider,
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
import {
  AshbyConnector,
  defaultAshbyBoards
} from "./connectors/ashby.js";
import {
  defaultGreenhouseBoards,
  GreenhouseConnector
} from "./connectors/greenhouse.js";
import { JobicyConnector, type JobicyRegion } from "./connectors/jobicy.js";
import {
  defaultLeverSites,
  LeverConnector
} from "./connectors/lever.js";
import { createDatabase } from "./database.js";
import {
  createDocxExport,
  createPdfExport,
  safeExportFileName,
  type DocumentExportInput
} from "./document-export.js";
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

function sendBinary(
  response: ServerResponse,
  body: Buffer,
  contentType: string,
  fileName: string
) {
  response.writeHead(200, {
    "Access-Control-Expose-Headers": "Content-Disposition",
    "Access-Control-Allow-Origin": webOrigin,
    "Content-Disposition": `attachment; filename="application"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Content-Length": body.length,
    "Content-Type": contentType
  });
  response.end(body);
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 131_072) throw new Error("Request body is too large");
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function isJobRegion(value: unknown): value is JobRegion {
  return value === "europe" || value === "latam" || value === "apac";
}

function isJobBoardProvider(value: unknown): value is JobBoardProvider {
  return value === "greenhouse" || value === "lever" || value === "ashby";
}

function parseJobBoards(value: unknown): JobBoardConfig[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 20).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const board = candidate as Record<string, unknown>;
    if (
      !isJobBoardProvider(board.provider) ||
      typeof board.token !== "string" ||
      typeof board.company !== "string"
    ) {
      return [];
    }

    const token = normalizeJobBoardToken(board.provider, board.token);
    const company = board.company.trim();
    if (
      !/^[a-zA-Z0-9_-]+$/.test(token) ||
      company.length === 0 ||
      company.length > 100
    ) {
      return [];
    }

    return [{ provider: board.provider, token, company }];
  });
}

function mergeProviderBoards<T>(
  defaults: T[],
  customBoards: JobBoardConfig[],
  provider: JobBoardProvider,
  key: (board: T) => string,
  create: (board: JobBoardConfig) => T
) {
  const boards = new Map(
    defaults.map((board) => [key(board).toLowerCase(), board])
  );
  for (const board of customBoards) {
    if (board.provider === provider) {
      boards.set(board.token.toLowerCase(), create(board));
    }
  }
  return [...boards.values()];
}

function parseDocumentExportInput(body: unknown): DocumentExportInput | null {
  if (!body || typeof body !== "object") return null;
  const candidate = body as Record<string, unknown>;
  const fields = [
    "candidateName",
    "jobTitle",
    "company",
    "location",
    "resumeSummary",
    "coverLetter"
  ] as const;

  if (
    fields.some(
      (field) =>
        typeof candidate[field] !== "string" ||
        candidate[field].trim().length === 0 ||
        candidate[field].length > 16_000
    )
  ) {
    return null;
  }

  return Object.fromEntries(
    fields.map((field) => [field, (candidate[field] as string).trim()])
  ) as unknown as DocumentExportInput;
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
          },
          {
            code: "greenhouse",
            name: "Greenhouse",
            regions: ["europe", "latam", "apac"],
            configured: true,
            boards: defaultGreenhouseBoards.length,
            databaseRequired: false
          },
          {
            code: "lever",
            name: "Lever",
            regions: ["europe", "latam", "apac"],
            configured: true,
            sites: defaultLeverSites.length,
            databaseRequired: false
          },
          {
            code: "ashby",
            name: "Ashby",
            regions: ["europe", "latam", "apac"],
            configured: true,
            boards: defaultAshbyBoards.length,
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
      requestUrl.pathname === "/v1/documents/export"
    ) {
      const input = parseDocumentExportInput(await readJsonBody(request));
      const format = requestUrl.searchParams.get("format");

      if (!input || (format !== "docx" && format !== "pdf")) {
        sendJson(response, 400, {
          error: "invalid_document_export",
          message: "Valid document content and format are required"
        });
        return;
      }

      const baseName = safeExportFileName(input);

      if (format === "docx") {
        const document = await createDocxExport(input);
        sendBinary(
          response,
          document,
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          `${baseName}.docx`
        );
      } else {
        const document = await createPdfExport(input);
        sendBinary(
          response,
          document,
          "application/pdf",
          `${baseName}.pdf`
        );
      }
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
      const customBoards = parseJobBoards(candidate.boards);

      if (role.length < 2) {
        sendJson(response, 400, {
          error: "invalid_profile",
          message: "Role must contain at least two characters"
        });
        return;
      }

      const previousMemoryJobs = memoryJobs;
      if (!repository) memoryJobs = [];

      const titles = expandRoleTitles(role, customAliases).slice(0, 6);
      const jobicy = new JobicyConnector();
      const arbeitnow = new ArbeitnowConnector();
      const greenhouse = new GreenhouseConnector();
      const lever = new LeverConnector();
      const ashby = new AshbyConnector();
      const greenhouseBoards = mergeProviderBoards(
        defaultGreenhouseBoards,
        customBoards,
        "greenhouse",
        (board) => board.token,
        (board) => ({ token: board.token, company: board.company })
      );
      const leverSites = mergeProviderBoards(
        defaultLeverSites,
        customBoards,
        "lever",
        (site) => site.site,
        (board) => ({ site: board.token, company: board.company })
      );
      const ashbyBoards = mergeProviderBoards(
        defaultAshbyBoards,
        customBoards,
        "ashby",
        (board) => board.name,
        (board) => ({ name: board.token, company: board.company })
      );
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

      searches.push(
        executeSync(
          repository,
          "greenhouse",
          {
            text: role,
            aliases: titles.slice(1),
            regions,
            boards: greenhouseBoards.map((board) => board.token)
          },
          () =>
            greenhouse.search({
              text: role,
              aliases: titles.slice(1),
              regions,
              boards: greenhouseBoards,
              matchContext: { role, aliases: titles.slice(1) }
            })
        ).then((result) => ({
          source: "greenhouse",
          query: role,
          fetched: result.data.fetched
        }))
      );

      searches.push(
        executeSync(
          repository,
          "lever",
          {
            text: role,
            aliases: titles.slice(1),
            regions,
            sites: leverSites.map((site) => site.site)
          },
          () =>
            lever.search({
              text: role,
              aliases: titles.slice(1),
              regions,
              sites: leverSites,
              matchContext: { role, aliases: titles.slice(1) }
            })
        ).then((result) => ({
          source: "lever",
          query: role,
          fetched: result.data.fetched
        }))
      );

      searches.push(
        executeSync(
          repository,
          "ashby",
          {
            text: role,
            aliases: titles.slice(1),
            regions,
            boards: ashbyBoards.map((board) => board.name)
          },
          () =>
            ashby.search({
              text: role,
              aliases: titles.slice(1),
              regions,
              boards: ashbyBoards,
              matchContext: { role, aliases: titles.slice(1) }
            })
        ).then((result) => ({
          source: "ashby",
          query: role,
          fetched: result.data.fetched
        }))
      );

      const settled = await Promise.allSettled(searches);
      const completed = settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      );
      const failed = settled.length - completed.length;

      if (completed.length === 0) {
        if (!repository) memoryJobs = previousMemoryJobs;
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

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/v1/sync/greenhouse"
    ) {
      const board = requestUrl.searchParams.get("board")?.trim() ?? "";
      const company = requestUrl.searchParams.get("company")?.trim() ?? board;
      const text =
        requestUrl.searchParams.get("text")?.trim() ?? "Product Analyst";

      if (!/^[a-zA-Z0-9_-]+$/.test(board) || company.length === 0) {
        sendJson(response, 400, {
          error: "invalid_greenhouse_board",
          message: "A valid board token and company are required"
        });
        return;
      }

      const query = { text, board, company };
      const connector = new GreenhouseConnector();

      try {
        const result = await executeSync(
          repository,
          "greenhouse",
          query,
          () =>
            connector.search({
              text,
              boards: [{ token: board, company }]
            })
        );
        sendJson(response, 200, result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown sync error";
        sendJson(response, 502, {
          error: "greenhouse_sync_failed",
          message
        });
      }
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/v1/sync/lever"
    ) {
      const site = requestUrl.searchParams.get("site")?.trim() ?? "";
      const company = requestUrl.searchParams.get("company")?.trim() ?? site;
      const text =
        requestUrl.searchParams.get("text")?.trim() ?? "Product Analyst";

      if (!/^[a-zA-Z0-9_-]+$/.test(site) || company.length === 0) {
        sendJson(response, 400, {
          error: "invalid_lever_site",
          message: "A valid site token and company are required"
        });
        return;
      }

      const query = { text, site, company };
      const connector = new LeverConnector();

      try {
        const result = await executeSync(
          repository,
          "lever",
          query,
          () =>
            connector.search({
              text,
              sites: [{ site, company }]
            })
        );
        sendJson(response, 200, result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown sync error";
        sendJson(response, 502, {
          error: "lever_sync_failed",
          message
        });
      }
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/v1/sync/ashby"
    ) {
      const rawBoard = requestUrl.searchParams.get("board")?.trim() ?? "";
      const board = normalizeJobBoardToken("ashby", rawBoard);
      const company = requestUrl.searchParams.get("company")?.trim() ?? board;
      const text =
        requestUrl.searchParams.get("text")?.trim() ?? "Product Analyst";

      if (!/^[a-zA-Z0-9_-]+$/.test(board) || company.length === 0) {
        sendJson(response, 400, {
          error: "invalid_ashby_board",
          message: "A valid board name and company are required"
        });
        return;
      }

      const query = { text, board, company };
      const connector = new AshbyConnector();

      try {
        const result = await executeSync(
          repository,
          "ashby",
          query,
          () =>
            connector.search({
              text,
              boards: [{ name: board, company }]
            })
        );
        sendJson(response, 200, result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown sync error";
        sendJson(response, 502, {
          error: "ashby_sync_failed",
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
