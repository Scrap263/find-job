import type { JobUpsert } from "../job-repository.js";
import {
  buildMatch,
  stableJobId,
  stripHtml,
  type MatchContext
} from "./shared.js";

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

export function normalizeArbeitnowJob(
  job: ArbeitnowJob,
  matchContext?: MatchContext
): JobUpsert {
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
    match: buildMatch(job.title, job.description, job.tags, matchContext),
    rawPayload: job
  };
}

export class ArbeitnowConnector {
  private readonly fetcher: typeof globalThis.fetch;

  constructor(fetcher: typeof globalThis.fetch = globalThis.fetch) {
    this.fetcher = fetcher;
  }

  async search(input: {
    text: string;
    aliases?: string[];
    page?: number;
    matchContext?: MatchContext;
  }) {
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
    const queries = [input.text, ...(input.aliases ?? [])]
      .map((query) => query.trim().toLowerCase())
      .filter(Boolean);
    const items = queries.length
      ? payload.data.filter((job) =>
          queries.some((query) => {
            const title = job.title.toLowerCase();
            const searchableText = [
              job.title,
              job.description,
              job.company_name,
              ...job.tags
            ]
              .join(" ")
              .toLowerCase();
            const tokens = query.split(/\s+/).filter((token) => token.length > 2);

            return (
              searchableText.includes(query) ||
              (tokens.length > 0 && tokens.every((token) => title.includes(token)))
            );
          })
        )
      : payload.data;

    return {
      jobs: items.map((job) =>
        normalizeArbeitnowJob(
          job,
          input.matchContext ?? {
            role: input.text,
            aliases: input.aliases
          }
        )
      ),
      meta: {
        fetched: payload.data.length,
        matched: items.length,
        page: payload.meta?.current_page ?? input.page ?? 1,
        hasNextPage: Boolean(payload.links?.next)
      }
    };
  }
}
