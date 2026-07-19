import { filterJobs, sampleJobs, type WorkplaceType } from "@find-job/domain";
import { createServer, type ServerResponse } from "node:http";
import { HhApiError, HhConnector } from "./connectors/hh.js";
import { createDatabase } from "./database.js";
import { JobRepository } from "./job-repository.js";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "127.0.0.1";
const webOrigin = process.env.WEB_ORIGIN ?? "*";
const database = createDatabase();
let repository = database ? new JobRepository(database) : null;

if (repository) {
  try {
    await repository.ping();
    console.log("PostgreSQL connection established.");
  } catch (error) {
    console.warn(
      "PostgreSQL is unavailable; falling back to demo vacancies.",
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
        database: repository ? "connected" : "demo",
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/v1/sources") {
      sendJson(response, 200, {
        data: [
          {
            code: "hh",
            name: "HeadHunter",
            configured: Boolean(process.env.HH_USER_AGENT),
            databaseRequired: true
          }
        ],
        meta: {
          database: repository ? "connected" : "demo"
        }
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/v1/jobs") {
      const filters = parseJobFilters(requestUrl);
      const jobs = repository
        ? await repository.list(filters)
        : filterJobs(sampleJobs, filters);

      sendJson(response, 200, {
        data: jobs,
        meta: {
          count: jobs.length,
          sources: [...new Set(jobs.map((job) => job.source))],
          storage: repository ? "postgres" : "demo",
          generatedAt: new Date().toISOString()
        }
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/v1/sync/hh") {
      if (!repository) {
        sendJson(response, 503, {
          error: "database_required",
          message: "Для синхронизации необходимо настроить DATABASE_URL."
        });
        return;
      }

      const userAgent = process.env.HH_USER_AGENT;
      if (!userAgent) {
        sendJson(response, 503, {
          error: "hh_configuration_required",
          message: "Для синхронизации необходимо настроить HH_USER_AGENT."
        });
        return;
      }

      const search = {
        text: requestUrl.searchParams.get("text") ?? "Product Analyst",
        area: requestUrl.searchParams.get("area") ?? "113",
        perPage: Math.min(
          100,
          Math.max(
            1,
            Number(requestUrl.searchParams.get("perPage") ?? 20) || 20
          )
        )
      };
      const run = await repository.startSync("hh", search);
      const connector = new HhConnector({
        userAgent,
        ...(process.env.HH_ACCESS_TOKEN
          ? { accessToken: process.env.HH_ACCESS_TOKEN }
          : {})
      });

      try {
        const result = await connector.search(search);
        const upserted = await repository.upsertMany(result.jobs);
        await repository.completeSync(run, {
          status: "completed",
          fetched: result.jobs.length,
          upserted
        });

        sendJson(response, 200, {
          data: {
            runId: run.id,
            fetched: result.jobs.length,
            upserted
          },
          meta: result.meta
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown sync error";
        await repository.completeSync(run, {
          status: "failed",
          fetched: 0,
          upserted: 0,
          error: message
        });

        if (error instanceof HhApiError) {
          sendJson(response, error.status === 429 ? 429 : 502, {
            error: `hh_${error.code}`,
            message:
              error.code === "captcha_required"
                ? "HeadHunter запросил CAPTCHA. Настройте HH_ACCESS_TOKEN."
                : message
          });
          return;
        }

        throw error;
      }
      return;
    }

    sendJson(response, 404, {
      error: "not_found",
      message: "Маршрут не найден"
    });
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, 500, {
        error: "internal_error",
        message: "Не удалось обработать запрос"
      });
    } else {
      response.end();
    }
  }
});

server.listen(port, host, () => {
  console.log(`Find Job API listening on http://${host}:${port}`);
});
