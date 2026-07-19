import type { JobRegion, WorkplaceType } from "@find-job/domain";
import type { JobUpsert } from "../job-repository.js";
import {
  buildMatch,
  stableJobId,
  stripHtml,
  type MatchContext
} from "./shared.js";

export type GreenhouseBoard = {
  token: string;
  company: string;
};

export const defaultGreenhouseBoards: GreenhouseBoard[] = [
  { token: "stripe", company: "Stripe" },
  { token: "cloudflare", company: "Cloudflare" },
  { token: "remotecom", company: "Remote" }
];

export type GreenhouseJob = {
  id: number;
  title: string;
  updated_at: string;
  absolute_url: string;
  location: {
    name: string;
  };
  content?: string;
  departments?: Array<{ name: string }>;
  offices?: Array<{ name: string; location?: string | null }>;
};

type GreenhouseResponse = {
  jobs: GreenhouseJob[];
};

const regionTerms: Record<JobRegion, string[]> = {
  europe: [
    "europe",
    "emea",
    "eu",
    "united kingdom",
    "uk",
    "ireland",
    "germany",
    "france",
    "spain",
    "portugal",
    "netherlands",
    "poland",
    "romania",
    "lithuania",
    "estonia",
    "latvia",
    "sweden",
    "norway",
    "finland",
    "denmark",
    "italy",
    "switzerland",
    "austria",
    "belgium",
    "prague",
    "berlin",
    "lisbon",
    "london",
    "dublin",
    "warsaw",
    "amsterdam"
  ],
  latam: [
    "latam",
    "latin america",
    "argentina",
    "brazil",
    "brasil",
    "mexico",
    "colombia",
    "chile",
    "peru",
    "uruguay",
    "costa rica",
    "panama",
    "são paulo",
    "sao paulo",
    "buenos aires",
    "bogotá",
    "bogota"
  ],
  apac: [
    "apac",
    "asia",
    "japac",
    "australia",
    "new zealand",
    "singapore",
    "india",
    "japan",
    "korea",
    "indonesia",
    "malaysia",
    "philippines",
    "thailand",
    "vietnam",
    "hong kong",
    "taiwan",
    "bangalore",
    "bengaluru",
    "tokyo",
    "sydney",
    "melbourne"
  ]
};

export function matchesSelectedRegions(
  location: string,
  regions: JobRegion[] = ["europe", "latam", "apac"]
) {
  const normalized = location.toLowerCase();
  if (
    !normalized ||
    normalized === "remote" ||
    normalized.includes("worldwide") ||
    normalized.includes("anywhere") ||
    normalized.includes("global")
  ) {
    return true;
  }

  return regions.some((region) =>
    regionTerms[region].some((term) =>
      term.length <= 3
        ? new RegExp(`\\b${term}\\b`, "u").test(normalized)
        : normalized.includes(term)
    )
  );
}

function inferWorkplaceType(job: GreenhouseJob): WorkplaceType {
  const text = `${job.location.name} ${job.content ?? ""}`.toLowerCase();
  if (text.includes("hybrid")) return "hybrid";
  if (text.includes("remote")) return "remote";
  return "onsite";
}

function matchesQuery(job: GreenhouseJob, queries: string[]) {
  if (queries.length === 0) return true;
  const title = stripHtml(job.title).toLowerCase();

  return queries.some((query) => {
    if (title.includes(query)) return true;
    const tokens = query.split(/\s+/).filter((token) => token.length > 2);
    return tokens.length > 0 && tokens.every((token) => title.includes(token));
  });
}

export function normalizeGreenhouseJob(
  job: GreenhouseJob,
  board: GreenhouseBoard,
  matchContext?: MatchContext
): JobUpsert {
  const externalId = `${board.token}:${job.id}`;
  const description = stripHtml(job.content ?? "");
  const tags = [
    ...(job.departments ?? []).map((department) => department.name),
    ...(job.offices ?? []).map((office) => office.name)
  ];

  return {
    id: stableJobId("greenhouse", externalId),
    externalId,
    title: stripHtml(job.title),
    company: board.company,
    location: stripHtml(job.location.name || "Worldwide"),
    workplaceType: inferWorkplaceType(job),
    publishedAt: new Date(job.updated_at).toISOString(),
    source: "greenhouse",
    applyUrl: job.absolute_url,
    match: buildMatch(job.title, description, tags, matchContext),
    rawPayload: { board: board.token, job }
  };
}

export class GreenhouseConnector {
  private readonly fetcher: typeof globalThis.fetch;

  constructor(fetcher: typeof globalThis.fetch = globalThis.fetch) {
    this.fetcher = fetcher;
  }

  async search(input: {
    text: string;
    aliases?: string[];
    regions?: JobRegion[];
    boards?: GreenhouseBoard[];
    matchContext?: MatchContext;
  }) {
    const boards = input.boards ?? defaultGreenhouseBoards;
    const queries = [input.text, ...(input.aliases ?? [])]
      .map((query) => query.trim().toLowerCase())
      .filter(Boolean);
    const settled = await Promise.allSettled(
      boards.map(async (board) => {
        const url = new URL(
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.token)}/jobs`
        );
        url.searchParams.set("content", "true");
        const response = await this.fetcher(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "FindJob/0.4"
          },
          signal: AbortSignal.timeout(15_000)
        });

        if (!response.ok) {
          throw new Error(
            `Greenhouse board ${board.token} returned ${response.status}`
          );
        }

        const payload = (await response.json()) as GreenhouseResponse;
        const jobs = payload.jobs
          .filter((job) => matchesQuery(job, queries))
          .filter((job) =>
            matchesSelectedRegions(job.location.name, input.regions)
          )
          .map((job) =>
            normalizeGreenhouseJob(
              job,
              board,
              input.matchContext ?? {
                role: input.text,
                aliases: input.aliases
              }
            )
          );

        return { board: board.token, fetched: payload.jobs.length, jobs };
      })
    );

    const completed = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );

    if (completed.length === 0 && boards.length > 0) {
      throw new Error("All Greenhouse boards failed");
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
