import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GreenhouseConnector,
  matchesSelectedRegions,
  normalizeGreenhouseJob,
  type GreenhouseJob
} from "./greenhouse.js";

const job: GreenhouseJob = {
  id: 123,
  title: "Senior Product Analyst",
  updated_at: "2026-07-10T10:00:00Z",
  absolute_url: "https://boards.greenhouse.io/example/jobs/123",
  location: { name: "Lisbon, Portugal" },
  content: "<p>SQL, experimentation and Amplitude.</p>",
  departments: [{ name: "Data" }]
};

describe("GreenhouseConnector", () => {
  it("normalizes a public board job", () => {
    const result = normalizeGreenhouseJob(
      job,
      { token: "example", company: "Example" },
      { role: "Product Analyst" }
    );

    assert.equal(result.source, "greenhouse");
    assert.equal(result.company, "Example");
    assert.equal(result.location, "Lisbon, Portugal");
    assert.ok(result.match.score >= 70);
  });

  it("keeps selected international regions", () => {
    assert.equal(matchesSelectedRegions("Berlin, Germany", ["europe"]), true);
    assert.equal(matchesSelectedRegions("São Paulo, Brazil", ["latam"]), true);
    assert.equal(matchesSelectedRegions("New York, NY", ["europe"]), false);
    assert.equal(matchesSelectedRegions("Fukuoka, Japan", ["europe"]), false);
    assert.equal(matchesSelectedRegions("Remote", ["apac"]), true);
  });

  it("isolates a failing board", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("broken")) return new Response(null, { status: 500 });
      return Response.json({ jobs: [job] });
    };
    const connector = new GreenhouseConnector(fetcher);
    const result = await connector.search({
      text: "Product Analyst",
      regions: ["europe"],
      boards: [
        { token: "example", company: "Example" },
        { token: "broken", company: "Broken" }
      ]
    });

    assert.equal(result.jobs.length, 1);
    assert.equal(result.meta.failedBoards, 1);
  });
});
