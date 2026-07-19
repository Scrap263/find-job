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

export type MatchContext = {
  role: string;
  aliases?: string[];
};

const roleHeads = [
  "analyst",
  "engineer",
  "developer",
  "manager",
  "designer",
  "researcher",
  "scientist",
  "architect",
  "consultant",
  "recruiter",
  "accountant"
] as const;

const ignoredTitleWords = new Set([
  "senior",
  "junior",
  "lead",
  "principal",
  "staff",
  "head",
  "global",
  "remote",
  "intern",
  "internship"
]);

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

function titleTokens(value: string) {
  return (
    stripHtml(value)
      .toLowerCase()
      .match(/[a-z0-9+#]+/g)
      ?.filter((token) => !ignoredTitleWords.has(token)) ?? []
  );
}

function calculateRoleFit(title: string, context: MatchContext) {
  const candidateTokens = titleTokens(title);
  const targetTitles = [context.role, ...(context.aliases ?? [])];
  let similarity = 0;

  for (const targetTitle of targetTitles) {
    const targetTokens = titleTokens(targetTitle);
    if (targetTokens.length === 0) continue;

    const shared = targetTokens.filter((token) =>
      candidateTokens.includes(token)
    ).length;
    similarity = Math.max(similarity, shared / targetTokens.length);
  }

  const targetHead = roleHeads.find((head) =>
    titleTokens(context.role).includes(head)
  );
  const candidateHead = roleHeads.find((head) =>
    candidateTokens.includes(head)
  );
  const headMismatch = Boolean(
    targetHead && candidateHead && targetHead !== candidateHead
  );

  return { similarity, targetHead, candidateHead, headMismatch };
}

export function buildMatch(
  title: string,
  description: string,
  tags: string[] = [],
  context: MatchContext = { role: "Product Analyst" }
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
  const roleFit = calculateRoleFit(title, context);
  let roleScore =
    roleFit.similarity >= 1
      ? 55
      : roleFit.similarity >= 0.67
        ? 45
        : roleFit.similarity >= 0.5
          ? 30
          : roleFit.similarity > 0
            ? 15
            : 0;

  if (roleFit.headMismatch) roleScore = Math.min(roleScore, 8);

  let score = Math.min(
    95,
    24 + roleScore + Math.min(24, matchedSkills.length * 4)
  );
  if (roleFit.similarity === 0) score = Math.min(score, 45);
  if (roleFit.headMismatch) score = Math.min(score, 58);

  const reason = roleFit.headMismatch
    ? `The title is adjacent, but this is a ${roleFit.candidateHead} role rather than a ${roleFit.targetHead} role.`
    : roleFit.similarity >= 0.67
      ? `The title closely matches ${context.role}; relevant skills increase confidence.`
      : roleFit.similarity >= 0.5
        ? `The role is a plausible alternative to ${context.role}, with transferable skills.`
        : `The title has limited overlap with ${context.role}; review it before applying.`;

  return {
    score,
    matchedSkills,
    missingSkills,
    reason
  };
}
