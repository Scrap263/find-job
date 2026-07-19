import type { JobRegion, WorkplaceType } from "@find-job/domain";
import type { JobUpsert } from "../job-repository.js";
import { matchesSelectedRegions } from "./greenhouse.js";
import {
  buildMatch,
  stableJobId,
  stripHtml,
  type MatchContext
} from "./shared.js";

export type LeverSite = {
  site: string;
  company: string;
};

export const defaultLeverSites: LeverSite[] = [
  { site: "spotify", company: "Spotify" },
  { site: "jumpcloud", company: "JumpCloud" },
  { site: "xsolla", company: "Xsolla" },
  { site: "economicmodeling", company: "Lightcast" },
  { site: "RyzLabs", company: "RYZ Labs" }
];

export type LeverJob = {
  id: string;
  text: string;
  createdAt: number;
  hostedUrl: string;
  applyUrl: string;
  workplaceType?: string;
  country?: string;
  descriptionPlain?: string;
  descriptionBodyPlain?: string;
  additionalPlain?: string;
  categories: {
    commitment?: string;
    department?: string;
    location?: string;
    team?: string;
    allLocations?: string[];
  };
  lists?: Array<{ text: string; content: string }>;
};

function inferWorkplaceType(job: LeverJob): WorkplaceType {
  const value = `${job.workplaceType ?? ""} ${job.categories.location ?? ""}`
    .trim()
    .toLowerCase();
  if (value.includes("hybrid")) return "hybrid";
  if (value.includes("remote")) return "remote";
  return "onsite";
}

function matchesQuery(job: LeverJob, queries: string[]) {
  if (queries.length === 0) return true;
  const title = stripHtml(job.text).toLowerCase();

  return queries.some((query) => {
    if (title.includes(query)) return true;
    const tokens = query.split(/\s+/).filter((token) => token.length > 2);
    return tokens.length > 0 && tokens.every((token) => title.includes(token));
  });
}

export function normalizeLeverJob(
  job: LeverJob,
  site: LeverSite,
  matchContext?: MatchContext
): JobUpsert {
  const externalId = `${site.site}:${job.id}`;
  const description = [
    job.descriptionPlain,
    job.descriptionBodyPlain,
    job.additionalPlain,
    ...(job.lists ?? []).map((list) => `${list.text} ${list.content}`)
  ]
    .filter(Boolean)
    .join(" ");
  const tags = [
    job.categories.department,
    job.categories.team,
    job.categories.commitment
  ].filter((value): value is string => Boolean(value));

  return {
    id: stableJobId("lever", externalId),
    externalId,
    title: stripHtml(job.text),
    company: site.company,
    location: stripHtml(job.categories.location || "Worldwide"),
    workplaceType: inferWorkplaceType(job),
    publishedAt: new Date(job.createdAt).toISOString(),
    source: "lever",
    applyUrl: job.hostedUrl || job.applyUrl,
    match: buildMatch(job.text, description, tags, matchContext),
    rawPayload: { site: site.site, job }
  };
}

export class LeverConnector {
  private readonly fetcher: typeof globalThis.fetch;

  constructor(fetcher: typeof globalThis.fetch = globalThis.fetch) {
    this.fetcher = fetcher;
  }

  async search(input: {
    text: string;
    aliases?: string[];
    regions?: JobRegion[];
    sites?: LeverSite[];
    matchContext?: MatchContext;
  }) {
    const sites = input.sites ?? defaultLeverSites;
    const queries = [input.text, ...(input.aliases ?? [])]
      .map((query) => query.trim().toLowerCase())
      .filter(Boolean);
    const settled = await Promise.allSettled(
      sites.map(async (site) => {
        const url = new URL(
          `https://api.lever.co/v0/postings/${encodeURIComponent(site.site)}`
        );
        url.searchParams.set("mode", "json");
        const response = await this.fetcher(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "FindJob/0.4"
          },
          signal: AbortSignal.timeout(15_000)
        });

        if (!response.ok) {
          throw new Error(`Lever site ${site.site} returned ${response.status}`);
        }

        const payload = (await response.json()) as LeverJob[];
        const jobs = payload
          .filter((job) => matchesQuery(job, queries))
          .filter((job) =>
            matchesSelectedRegions(
              job.categories.location ?? "",
              input.regions
            )
          )
          .map((job) =>
            normalizeLeverJob(
              job,
              site,
              input.matchContext ?? {
                role: input.text,
                aliases: input.aliases
              }
            )
          );

        return { site: site.site, fetched: payload.length, jobs };
      })
    );

    const completed = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );

    if (completed.length === 0 && sites.length > 0) {
      throw new Error("All Lever sites failed");
    }

    return {
      jobs: completed.flatMap((result) => result.jobs),
      meta: {
        sites: completed.length,
        failedSites: settled.length - completed.length,
        scanned: completed.reduce((total, result) => total + result.fetched, 0),
        matched: completed.reduce(
          (total, result) => total + result.jobs.length,
          0
        )
      }
    };
  }
}
