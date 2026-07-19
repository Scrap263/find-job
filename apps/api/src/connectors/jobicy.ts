import type { JobUpsert } from "../job-repository.js";
import {
  buildMatch,
  stableJobId,
  stripHtml,
  type MatchContext
} from "./shared.js";

export type JobicyRegion = "europe" | "latam" | "apac" | "anywhere";

export type JobicyJob = {
  id: number;
  url: string;
  jobTitle: string;
  companyName: string;
  jobIndustry: string[];
  jobType: string[];
  jobGeo: string;
  jobLevel: string;
  jobExcerpt: string;
  jobDescription: string;
  pubDate: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
};

type JobicyResponse = {
  jobs: JobicyJob[];
  jobCount: number;
  lastUpdate: string;
};

function normalizeCurrency(value?: string | null): "RUB" | "USD" | "EUR" | null {
  if (value === "RUB" || value === "USD" || value === "EUR") return value;
  return null;
}

export function normalizeJobicyJob(
  job: JobicyJob,
  matchContext?: MatchContext
): JobUpsert {
  const currency = normalizeCurrency(job.salaryCurrency);
  const salary =
    typeof job.salaryMin === "number" &&
    typeof job.salaryMax === "number" &&
    currency
      ? {
          min: Math.round(job.salaryMin),
          max: Math.round(job.salaryMax),
          currency
        }
      : undefined;

  return {
    id: stableJobId("jobicy", String(job.id)),
    externalId: String(job.id),
    title: stripHtml(job.jobTitle),
    company: stripHtml(job.companyName),
    location: stripHtml(job.jobGeo || "Worldwide"),
    workplaceType: "remote",
    ...(salary ? { salary } : {}),
    publishedAt: job.pubDate,
    source: "jobicy",
    applyUrl: job.url,
    match: buildMatch(
      job.jobTitle,
      job.jobDescription,
      job.jobIndustry,
      matchContext
    ),
    rawPayload: job
  };
}

export class JobicyConnector {
  private readonly fetcher: typeof globalThis.fetch;

  constructor(fetcher: typeof globalThis.fetch = globalThis.fetch) {
    this.fetcher = fetcher;
  }

  async search(input: {
    text: string;
    region?: JobicyRegion;
    count?: number;
    matchContext?: MatchContext;
  }) {
    const url = new URL("https://jobicy.com/api/v2/remote-jobs");
    url.searchParams.set("count", String(Math.min(100, input.count ?? 50)));
    if (input.text.trim()) url.searchParams.set("tag", input.text.trim());
    if (input.region && input.region !== "anywhere") {
      url.searchParams.set("geo", input.region);
    }

    const response = await this.fetcher(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "FindJob/0.3"
      }
    });

    if (!response.ok) {
      throw new Error(`Jobicy API returned ${response.status}`);
    }

    const payload = (await response.json()) as JobicyResponse;

    return {
      jobs: payload.jobs.map((job) =>
        normalizeJobicyJob(job, input.matchContext ?? { role: input.text })
      ),
      meta: {
        found: payload.jobCount,
        lastUpdate: payload.lastUpdate,
        region: input.region ?? "anywhere"
      }
    };
  }
}
