import type { JobUpsert } from "../job-repository.js";
import { buildMatch, stableJobId, stripHtml } from "./shared.js";

export type ArbeitnowJob = {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags: string[];
  job_types: string[];
  location: string;
  created_at: number;
};

type ArbeitnowResponse = {
  data: ArbeitnowJob[];
  links?: {
    next?: string | null;
  };
  meta?: {
    current_page?: number;
    last_page?: number;
  };
};

export function normalizeArbeitnowJob(job: ArbeitnowJob): JobUpsert {
  return {
    id: stableJobId("arbeitnow", job.slug),
    externalId: job.slug,
    title: stripHtml(job.title),
    company: stripHtml(job.company_name),
    location: stripHtml(job.location || "Europe"),
    workplaceType: job.remote ? "remote" : "onsite",
    publishedAt: new Date(job.created_at * 1000).toISOString(),
    source: "arbeitnow",
    applyUrl: job.url,
    match: buildMatch(job.title, job.description, job.tags),
    rawPayload: job
  };
}

export class ArbeitnowConnector {
  private readonly fetcher: typeof globalThis.fetch;

  constructor(fetcher: typeof globalThis.fetch = globalThis.fetch) {
    this.fetcher = fetcher;
  }

  async search(input: { text: string; page?: number }) {
    const url = new URL("https://www.arbeitnow.com/api/job-board-api");
    url.searchParams.set("page", String(Math.max(1, input.page ?? 1)));

    const response = await this.fetcher(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "FindJob/0.3"
      }
    });

    if (!response.ok) {
      throw new Error(`Arbeitnow API returned ${response.status}`);
    }

    const payload = (await response.json()) as ArbeitnowResponse;
    const query = input.text.trim().toLowerCase();
    const items = query
      ? payload.data.filter((job) =>
          [job.title, job.description, job.company_name, ...job.tags]
            .join(" ")
            .toLowerCase()
            .includes(query)
        )
      : payload.data;

    return {
      jobs: items.map(normalizeArbeitnowJob),
      meta: {
        fetched: payload.data.length,
        matched: items.length,
        page: payload.meta?.current_page ?? input.page ?? 1,
        hasNextPage: Boolean(payload.links?.next)
      }
    };
  }
}
