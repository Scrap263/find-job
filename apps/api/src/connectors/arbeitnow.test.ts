import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ArbeitnowConnector,
  normalizeArbeitnowJob,
  type ArbeitnowJob
} from "./arbeitnow.js";

const job: ArbeitnowJob = {
  slug: "product-data-analyst-berlin",
  company_name: "Example GmbH",
  title: "Product Data Analyst",
  description: "Build product metrics with SQL and Tableau.",
  remote: false,
  url: "https://www.arbeitnow.com/jobs/product-data-analyst-berlin",
  tags: ["Data", "Analytics"],
  job_types: ["full-time"],
  location: "Berlin",
  created_at: 1_784_471_446
};

describe("ArbeitnowConnector", () => {
  it("normalizes a European vacancy", () => {
    const result = normalizeArbeitnowJob(job);

    assert.equal(result.source, "arbeitnow");
    assert.equal(result.location, "Berlin");
    assert.equal(result.workplaceType, "onsite");
    assert.ok(result.match.matchedSkills.includes("SQL"));
  });

  it("filters the fetched page by search text", async () => {
    const connector = new ArbeitnowConnector(async () =>
      Response.json({
        data: [
          job,
          {
            ...job,
            slug: "designer",
            title: "Product Designer",
            description: "Design user interfaces",
            tags: ["Design"]
          }
        ],
        links: { next: null },
        meta: { current_page: 1, last_page: 1 }
      })
    );

    const result = await connector.search({ text: "SQL", page: 1 });

    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0]?.externalId, job.slug);
  });

  it("matches alternative role titles", async () => {
    const connector = new ArbeitnowConnector(async () =>
      Response.json({
        data: [
          job,
          {
            ...job,
            slug: "growth-analyst",
            title: "Growth Analyst",
            description: "Own activation and retention metrics."
          }
        ]
      })
    );

    const result = await connector.search({
      text: "Product Analyst",
      aliases: ["Growth Analyst"]
    });

    assert.deepEqual(
      result.jobs.map((item) => item.externalId),
      [job.slug, "growth-analyst"]
    );
  });
});
