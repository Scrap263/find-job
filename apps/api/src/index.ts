import { filterJobs, sampleJobs, type WorkplaceType } from "@find-job/domain";
import { createServer, type ServerResponse } from "node:http";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "127.0.0.1";
const webOrigin = process.env.WEB_ORIGIN ?? "*";

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": webOrigin,
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    sendJson(response, 200, {
      status: "ok",
      service: "find-job-api",
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/v1/jobs") {
    const workplaceParam = requestUrl.searchParams.get("workplace");
    const workplace: WorkplaceType | "all" =
      workplaceParam === "remote" ||
      workplaceParam === "hybrid" ||
      workplaceParam === "onsite"
        ? workplaceParam
        : "all";
    const minScoreParam = Number(requestUrl.searchParams.get("minScore") ?? 0);
    const minScore = Number.isFinite(minScoreParam) ? minScoreParam : 0;

  const jobs = filterJobs(sampleJobs, {
      query: requestUrl.searchParams.get("q") ?? "",
      workplace,
      minScore
  });

    sendJson(response, 200, {
      data: jobs,
      meta: {
        count: jobs.length,
        sources: [...new Set(jobs.map((job) => job.source))],
        generatedAt: new Date().toISOString()
      }
    });
    return;
  }

  sendJson(response, 404, {
    error: "not_found",
    message: "Маршрут не найден"
  });
});

server.listen(port, host, () => {
  console.log(`Find Job API listening on http://${host}:${port}`);
});
