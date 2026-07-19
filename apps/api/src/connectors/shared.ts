import type { Job } from "@find-job/domain";
import { createHash } from "node:crypto";

const skillDictionary = [
  "SQL",
  "Python",
  "A/B tests",
  "Amplitude",
  "Mixpanel",
  "Tableau",
  "Power BI",
  "ClickHouse",
  "Airflow",
  "dbt",
  "Looker",
  "BigQuery"
] as const;

export function stripHtml(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stableJobId(source: string, externalId: string) {
  const digest = createHash("sha256")
    .update(`${source}:${externalId}`)
    .digest("hex")
    .slice(0, 32);

  return `${source}-${digest}`;
}

export function buildMatch(
  title: string,
  description: string,
  tags: string[] = []
): Job["match"] {
  const text = stripHtml([title, description, ...tags].join(" ")).toLowerCase();
  const aliases = new Map<string, string[]>([
    ["A/B tests", ["a/b test", "ab test", "experimentation"]],
    ["Power BI", ["power bi", "powerbi"]]
  ]);

  const matchedSkills = skillDictionary.filter((skill) => {
    const terms = aliases.get(skill) ?? [skill.toLowerCase()];
    return terms.some((term) => text.includes(term));
  });
  const missingSkills = matchedSkills.includes("SQL") ? [] : ["SQL"];
  const productRole = /product|growth|insight|продукт/i.test(title);
  const score = Math.min(
    95,
    54 + matchedSkills.length * 6 + (productRole ? 15 : 0)
  );

  return {
    score,
    matchedSkills,
    missingSkills,
    reason: productRole
      ? "The role is product-oriented and matches the identified analytics skills."
      : "The role overlaps with the target analytics skills but its product focus needs review."
  };
}
