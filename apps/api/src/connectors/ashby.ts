import type { JobRegion, WorkplaceType } from "@find-job/domain";
import type { JobUpsert } from "../job-repository.js";
import { matchesSelectedRegions } from "./greenhouse.js";
import {
  buildMatch,
  stableJobId,
  stripHtml,
  type MatchContext
} from "./shared.js";

export type AshbyBoard = {
  name: string;
  company: string;
};

export const defaultAshbyBoards: AshbyBoard[] = [
  { name: "ashby", company: "Ashby" },
  { name: "linear", company: "Linear" },
  { name: "notion", company: "Notion" },
  { name: "supabase", company: "Supabase" }
];

type AshbyCompensationComponent = {
  compensationType?: string;
  interval?: string;
  currencyCode?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
};

export type AshbyJob = {
  title: string;
  location: string;
  secondaryLocations?: Array<{ location?: string }>;
  department?: string;
  team?: string;
  isListed?: boolean;
  isRemote?: boolean;
  workplaceType?: "OnSite" | "Remote" | "Hybrid" | string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  publishedAt: string;
  employmentType?: string;
  jobUrl: string;
  applyUrl: string;
  compensation?: {
    summaryComponents?: AshbyCompensationComponent[];
  };
};

type AshbyResponse = {
  apiVersion: string;
  jobs: AshbyJob[];
};

function inferWorkplaceType(job: AshbyJob): WorkplaceType {
  const value = `${job.workplaceType ?? ""} ${job.location}`.toLowerCase();
  if (value.includes("hybrid")) return "hybrid";
  if (value.includes("remote") || job.isRemote) return "remote";
  return "onsite";
}

function matchesQuery(job: AshbyJob, queries: string[]) {
  if (queries.length === 0) return true;
  const title = stripHtml(job.title).toLowerCase();

  return queries.some((query) => {
    if (title.includes(query)) return true;
    const tokens = query.split(/\s+/).filter((token) => token.length > 2);
    return tokens.length > 0 && tokens.every((token) => title.includes(token));
  });
}

function normalizeSalary(job: AshbyJob): JobUpsert["salary"] {
  const salary = job.compensation?.summaryComponents?.find(
    (component) =>
      component.compensationType === "Salary" &&
      component.interval === "1 YEAR" &&
      typeof component.minValue === "number" &&
      typeof component.maxValue === "number" &&
      (component.currencyCode === "USD" || component.currencyCode === "EUR")
  );

  if (
    !salary ||
    (salary.currencyCode !== "USD" && salary.currencyCode !== "EUR") ||
    salary.minValue === null ||
    salary.minValue === undefined ||
    salary.maxValue === null ||
    salary.maxValue === undefined
  ) {
    return undefined;
  }

  return {
    min: Math.round(salary.minValue),
    max: Math.round(salary.maxValue),
    currency: salary.currencyCode
  };
}

export function normalizeAshbyJob(
  job: AshbyJob,
  board: AshbyBoard,
  matchContext?: MatchContext
): JobUpsert {
  const externalId = `${board.name}:${job.jobUrl}`;
  const salary = normalizeSalary(job);

  return {
    id: stableJobId("ashby", externalId),
    externalId,
    title: stripHtml(job.title),
    company: board.company,
    location: stripHtml(job.location || "Worldwide"),
    workplaceType: inferWorkplaceType(job),
    ...(salary ? { salary } : {}),
    publishedAt: new Date(job.publishedAt).toISOString(),
    source: "ashby",
    applyUrl: job.jobUrl || job.applyUrl,
    match: buildMatch(
      job.title,
      job.descriptionPlain ?? job.descriptionHtml ?? "",
      [job.department, job.team, job.employmentType].filter(
        (value): value is string => Boolean(value)
      ),
      matchContext
    ),
    rawPayload: { board: board.name, job }
  };
}

export class AshbyConnector {
  private readonly fetcher: typeof globalThis.fetch;

  constructor(fetcher: typeof globalThis.fetch = globalThis.fetch) {
    this.fetcher = fetcher;
  }

  async search(input: {
    text: string;
    aliases?: string[];
    regions?: JobRegion[];
    boards?: AshbyBoard[];
    matchContext?: MatchContext;
  }) {
    const boards = input.boards ?? defaultAshbyBoards;
    const queries = [input.text, ...(input.aliases ?? [])]
      .map((query) => query.trim().toLowerCase())
      .filter(Boolean);
    const settled = await Promise.allSettled(
      boards.map(async (board) => {
        const url = new URL(
          `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.name)}`
        );
        url.searchParams.set("includeCompensation", "true");
        const response = await this.fetcher(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "FindJob/0.5"
          },
          signal: AbortSignal.timeout(15_000)
        });

        if (!response.ok) {
          throw new Error(`Ashby board ${board.name} returned ${response.status}`);
        }

        const payload = (await response.json()) as AshbyResponse;
        const jobs = payload.jobs
          .filter((job) => job.isListed !== false)
          .filter((job) => matchesQuery(job, queries))
          .filter((job) =>
            matchesSelectedRegions(
              [
                job.location,
                ...(job.secondaryLocations ?? []).map(
                  (location) => location.location ?? ""
                )
              ].join(" · "),
              input.regions
            )
          )
          .map((job) =>
            normalizeAshbyJob(
              job,
              board,
              input.matchContext ?? {
                role: input.text,
                aliases: input.aliases
              }
            )
          );

        return { board: board.name, fetched: payload.jobs.length, jobs };
      })
    );

    const completed = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );

    if (completed.length === 0 && boards.length > 0) {
      throw new Error("All Ashby boards failed");
    }

    return {
      jobs: completed.flatMap((result) => result.jobs),
      meta: {
        boards: completed.length,
        failedBoards: settled.length - completed.length,
        scanned: completed.reduce((total, result) => total + result.fetched, 0),
        matched: completed.reduce(
          (total, result) => total + result.jobs.length,
          0
        )
      }
    };
  }
}
