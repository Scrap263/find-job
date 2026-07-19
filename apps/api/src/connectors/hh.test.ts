import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HhApiError,
  HhConnector,
  normalizeHhVacancy,
  type HhVacancy
} from "./hh.ts";

const vacancy: HhVacancy = {
  id: "12345",
  name: "Senior Product Analyst",
  alternate_url: "https://hh.ru/vacancy/12345",
  published_at: "2026-07-19T10:00:00+0300",
  employer: { name: "Example" },
  area: { id: "1", name: "Москва" },
  salary: { from: 250_000, to: 330_000, currency: "RUR", gross: false },
  schedule: { id: "remote", name: "Удалённая работа" },
  work_format: [{ id: "REMOTE", name: "Удалённо" }],
  snippet: {
    requirement: "SQL, Python, A/B тесты и Amplitude",
    responsibility: "Развитие продуктовых метрик"
  }
};

describe("normalizeHhVacancy", () => {
  it("maps HH fields into the canonical job model", () => {
    const result = normalizeHhVacancy(vacancy);

    assert.equal(result.externalId, "12345");
    assert.equal(result.source, "hh");
    assert.equal(result.workplaceType, "remote");
    assert.deepEqual(result.salary, {
      min: 250_000,
      max: 330_000,
      currency: "RUB"
    });
    assert.ok(result.match.score >= 80);
    assert.deepEqual(result.match.matchedSkills, [
      "SQL",
      "Python",
      "A/B тесты",
      "Amplitude"
    ]);
  });
});

describe("HhConnector", () => {
  it("sends the required HH user-agent and maps the response", async () => {
    let receivedHeaders: Headers | undefined;
    const connector = new HhConnector({
      userAgent: "FindJob/0.2 (test@example.com)",
      fetch: async (_input, init) => {
        receivedHeaders = new Headers(init?.headers);
        return Response.json({
          items: [vacancy],
          found: 1,
          pages: 1,
          page: 0,
          per_page: 20
        });
      }
    });

    const result = await connector.search({ text: "Product Analyst" });

    assert.equal(receivedHeaders?.get("HH-User-Agent"), "FindJob/0.2 (test@example.com)");
    assert.equal(result.jobs.length, 1);
    assert.equal(result.meta.found, 1);
  });

  it("exposes captcha responses as a typed error", async () => {
    const connector = new HhConnector({
      userAgent: "FindJob/0.2 (test@example.com)",
      fetch: async () => new Response(null, { status: 403 })
    });

    await assert.rejects(
      () => connector.search({ text: "Product Analyst" }),
      (error: unknown) =>
        error instanceof HhApiError && error.code === "captcha_required"
    );
  });
});
