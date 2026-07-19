import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expandRoleTitles,
  filterJobs,
  generateApplicationDraft,
  sampleJobs
} from "./index.ts";

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
      ["arbeitnow-204", "jobicy-310"]
    );
  });
});

describe("expandRoleTitles", () => {
  it("adds related international titles for a known role", () => {
    assert.deepEqual(expandRoleTitles("Product Analyst").slice(0, 3), [
      "Product Analyst",
      "Product Data Analyst",
      "Growth Analyst"
    ]);
  });

  it("keeps custom aliases unique", () => {
    assert.deepEqual(expandRoleTitles("UX Researcher", [
      "User Researcher",
      "ux researcher"
    ]), ["UX Researcher", "User Researcher"]);
  });

  it("does not confuse a broad role with a more specific role group", () => {
    assert.deepEqual(expandRoleTitles("Data Analyst").slice(0, 3), [
      "Data Analyst",
      "Business Intelligence Analyst",
      "BI Analyst"
    ]);
  });
});

describe("generateApplicationDraft", () => {
  it("uses only candidate-provided skills and facts", () => {
    const draft = generateApplicationDraft(sampleJobs[0]!, {
      name: "Alex",
      headline: "Product analyst",
      skills: ["SQL"],
      facts: ["Improved activation reporting"]
    });

    assert.match(draft.resumeSummary, /Improved activation reporting/);
    assert.match(draft.coverLetter, /SQL/);
    assert.ok(!draft.usedSkills.includes("Python"));
    assert.ok(draft.skillsToVerify.includes("Python"));
  });

  it("does not invent experience when facts are empty", () => {
    const draft = generateApplicationDraft(sampleJobs[0]!, {
      name: "Alex",
      headline: "",
      skills: [],
      facts: []
    });

    assert.match(
      draft.resumeSummary,
      /Подтверждённые достижения пока не добавлены/
    );
    assert.ok(!/\d+ лет|years of experience/i.test(draft.coverLetter));
  });
});
