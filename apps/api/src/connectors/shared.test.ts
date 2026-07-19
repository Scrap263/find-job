import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMatch } from "./shared.js";

const profile = {
  role: "Product Analyst",
  aliases: [
    "Product Data Analyst",
    "Growth Analyst",
    "Product Insights Analyst",
    "BI Analyst"
  ]
};

describe("buildMatch", () => {
  it("ranks an exact analyst role highly", () => {
    const match = buildMatch(
      "Senior Product Analyst",
      "Own product experiments with SQL and Amplitude.",
      [],
      profile
    );

    assert.ok(match.score >= 80);
  });

  it("keeps a related analyst title above the default feed threshold", () => {
    const match = buildMatch(
      "Senior Data Analyst",
      "Use SQL, Python, Tableau and dbt.",
      [],
      profile
    );

    assert.ok(match.score >= 70);
  });

  it("penalizes an engineer role even when many skills overlap", () => {
    const match = buildMatch(
      "Senior Data Engineer",
      "SQL Python Tableau ClickHouse Airflow dbt Looker BigQuery",
      [],
      profile
    );

    assert.ok(match.score < 70);
    assert.match(match.reason, /engineer role rather than a analyst role/);
  });

  it("penalizes a product manager role for an analyst profile", () => {
    const match = buildMatch(
      "Principal Product Manager",
      "Own product experiments and use SQL.",
      [],
      profile
    );

    assert.ok(match.score < 70);
  });
});
