import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  JobicyConnector,
  normalizeJobicyJob,
  type JobicyJob
} from "./jobicy.js";

const job: JobicyJob = {
  id: 143979,
  url: "https://jobicy.com/jobs/143979-senior-data-analyst",
  jobTitle: "Senior Product Data Analyst",
  companyName: "Ruby Labs",
  jobIndustry: ["Data Science & Analytics"],
  jobType: ["Full-Time"],
  jobGeo: "Europe",
  jobLevel: "Senior",
  jobExcerpt: "Product analytics role",
  jobDescription: "Advanced SQL, A/B testing, Amplitude and Python.",
  pubDate: "2026-07-19T09:40:05+00:00",
  salaryMin: 70_000,
  salaryMax: 90_000,
  salaryCurrency: "USD"
};

describe("JobicyConnector", () => {
  it("normalizes a global remote job", () => {
    const result = normalizeJobicyJob(job);

    assert.equal(result.source, "jobicy");
    assert.equal(result.workplaceType, "remote");
    assert.equal(result.location, "Europe");
    assert.deepEqual(result.salary, {
      min: 70_000,
      max: 90_000,
      currency: "USD"
    });
    assert.ok(result.match.matchedSkills.includes("SQL"));
  });

  it("passes region and search filters to the public API", async () => {
    let requestedUrl = "";
    const connector = new JobicyConnector(async (input) => {
      requestedUrl = String(input);
      return Response.json({
        jobs: [job],
        jobCount: 1,
        lastUpdate: "2026-07-19T10:00:00+00:00"
      });
    });

    const result = await connector.search({
      text: "product analyst",
      region: "latam",
      count: 20
    });

    assert.match(requestedUrl, /geo=latam/);
    assert.match(requestedUrl, /tag=product\+analyst/);
    assert.equal(result.jobs.length, 1);
  });
});
