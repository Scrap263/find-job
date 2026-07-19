import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LeverConnector,
  normalizeLeverJob,
  type LeverJob
} from "./lever.js";

const job: LeverJob = {
  id: "abc-123",
  text: "Product Data Analyst",
  createdAt: Date.parse("2026-07-10T10:00:00Z"),
  hostedUrl: "https://jobs.lever.co/example/abc-123",
  applyUrl: "https://jobs.lever.co/example/abc-123/apply",
  workplaceType: "remote",
  descriptionPlain: "Build product metrics with SQL and Looker.",
  categories: {
    department: "Data",
    location: "Remote - Poland",
    commitment: "Full time"
  }
};

describe("LeverConnector", () => {
  it("normalizes a Lever posting", () => {
    const result = normalizeLeverJob(
      job,
      { site: "example", company: "Example" },
      { role: "Product Analyst" }
    );

    assert.equal(result.source, "lever");
    assert.equal(result.workplaceType, "remote");
    assert.equal(result.company, "Example");
    assert.ok(result.match.matchedSkills.includes("SQL"));
  });

  it("filters by role and region", async () => {
    const fetcher: typeof fetch = async () =>
      Response.json([
        job,
        {
          ...job,
          id: "other",
          text: "Account Executive",
          categories: { location: "New York, NY" }
        }
      ]);
    const connector = new LeverConnector(fetcher);
    const result = await connector.search({
      text: "Product Analyst",
      regions: ["europe"],
      sites: [{ site: "example", company: "Example" }]
    });

    assert.equal(result.jobs.length, 1);
    assert.equal(result.meta.matched, 1);
  });
});
