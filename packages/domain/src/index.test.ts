import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterJobs, sampleJobs } from "./index.ts";

describe("filterJobs", () => {
  it("sorts matching jobs by score", () => {
    const result = filterJobs(sampleJobs, {
      query: "",
      workplace: "all",
      minScore: 80
    });

    assert.deepEqual(
      result.map((job) => job.match.score),
      [93, 89, 86, 84]
    );
  });

  it("searches by title, company and skills", () => {
    const result = filterJobs(sampleJobs, {
      query: "Amplitude",
      workplace: "all",
      minScore: 0
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.company, "Finwave");
  });

  it("combines workplace and score filters", () => {
    const result = filterJobs(sampleJobs, {
      query: "",
      workplace: "remote",
      minScore: 85
    });

    assert.deepEqual(
      result.map((job) => job.id),
      ["gh-204", "lever-310"]
    );
  });
});
