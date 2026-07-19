import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AshbyConnector,
  normalizeAshbyJob,
  type AshbyJob
} from "./ashby.js";

const job: AshbyJob = {
  title: "Product Data Analyst",
  location: "Remote - Europe",
  isListed: true,
  isRemote: true,
  workplaceType: "Remote",
  descriptionPlain: "Own product metrics using SQL and Looker.",
  publishedAt: "2026-07-10T10:00:00Z",
  employmentType: "FullTime",
  jobUrl: "https://jobs.ashbyhq.com/example/abc",
  applyUrl: "https://jobs.ashbyhq.com/example/abc/application",
  compensation: {
    summaryComponents: [
      {
        compensationType: "Salary",
        interval: "1 YEAR",
        currencyCode: "EUR",
        minValue: 70000,
        maxValue: 90000
      }
    ]
  }
};

describe("AshbyConnector", () => {
  it("normalizes a public posting with compensation", () => {
    const result = normalizeAshbyJob(
      job,
      { name: "example", company: "Example" },
      { role: "Product Analyst" }
    );

    assert.equal(result.source, "ashby");
    assert.equal(result.workplaceType, "remote");
    assert.deepEqual(result.salary, {
      min: 70000,
      max: 90000,
      currency: "EUR"
    });
    assert.ok(result.match.score >= 70);
  });

  it("trusts an explicit remote location over a conflicting ATS type", () => {
    const result = normalizeAshbyJob(
      { ...job, isRemote: false, workplaceType: "OnSite" },
      { name: "example", company: "Example" }
    );

    assert.equal(result.workplaceType, "remote");
  });

  it("skips unlisted and out-of-region jobs", async () => {
    const fetcher: typeof fetch = async () =>
      Response.json({
        apiVersion: "1",
        jobs: [
          job,
          { ...job, jobUrl: `${job.jobUrl}-hidden`, isListed: false },
          {
            ...job,
            jobUrl: `${job.jobUrl}-us`,
            location: "New York, USA",
            isRemote: false,
            workplaceType: "OnSite"
          }
        ]
      });
    const connector = new AshbyConnector(fetcher);
    const result = await connector.search({
      text: "Product Analyst",
      regions: ["europe"],
      boards: [{ name: "example", company: "Example" }]
    });

    assert.equal(result.jobs.length, 1);
    assert.equal(result.meta.scanned, 3);
  });
});
