import type { Job, WorkplaceType } from "@find-job/domain";
import { createHash } from "node:crypto";
import type { JobUpsert } from "../job-repository.js";

type HhNamedItem = {
  id: string;
  name: string;
};

type HhSalary = {
  from: number | null;
  to: number | null;
  currency: string;
  gross: boolean | null;
};

export type HhVacancy = {
  id: string;
  name: string;
  alternate_url: string;
  published_at: string;
  employer: {
    name: string;
  } | null;
  area: HhNamedItem;
  salary: HhSalary | null;
  salary_range?: HhSalary | null;
  schedule?: HhNamedItem | null;
  work_format?: HhNamedItem[] | null;
  snippet?: {
    requirement: string | null;
    responsibility: string | null;
  } | null;
};

type HhSearchResponse = {
  items: HhVacancy[];
  found: number;
  pages: number;
  page: number;
  per_page: number;
};

export type HhSearchInput = {
  text: string;
  area?: string;
  page?: number;
  perPage?: number;
};

export class HhApiError extends Error {
  readonly status: number;
  readonly code: "captcha_required" | "rate_limited" | "request_failed";

  constructor(
    message: string,
    status: number,
    code: "captcha_required" | "rate_limited" | "request_failed"
  ) {
    super(message);
    this.name = "HhApiError";
    this.status = status;
    this.code = code;
  }
}

const skillDictionary = [
  "SQL",
  "Python",
  "A/B тесты",
  "Amplitude",
  "Tableau",
  "Power BI",
  "ClickHouse",
  "Airflow",
  "dbt",
  "Looker"
] as const;

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, " ");
}

function classifyWorkplace(vacancy: HhVacancy): WorkplaceType {
  const formats = vacancy.work_format?.map((item) => item.id.toLowerCase()) ?? [];
  const schedule = vacancy.schedule?.id.toLowerCase() ?? "";

  if (
    formats.some((format) => format.includes("remote")) ||
    schedule.includes("remote")
  ) {
    return "remote";
  }

  if (formats.some((format) => format.includes("hybrid"))) return "hybrid";
  return "onsite";
}

function normalizeCurrency(currency: string): "RUB" | "USD" | "EUR" | null {
  if (currency === "RUR" || currency === "RUB") return "RUB";
  if (currency === "USD" || currency === "EUR") return currency;
  return null;
}

function extractMatch(vacancy: HhVacancy): Job["match"] {
  const text = [
    vacancy.name,
    vacancy.snippet?.requirement ?? "",
    vacancy.snippet?.responsibility ?? ""
  ]
    .map(stripHtml)
    .join(" ")
    .toLocaleLowerCase("ru");

  const matchedSkills = skillDictionary.filter((skill) =>
    text.includes(skill.toLocaleLowerCase("ru"))
  );
  const missingSkills = matchedSkills.includes("SQL") ? [] : ["SQL"];
  const productRole = /product|продукт|growth|insights/i.test(vacancy.name);
  const score = Math.min(
    95,
    55 + matchedSkills.length * 6 + (productRole ? 14 : 0)
  );

  return {
    score,
    matchedSkills,
    missingSkills,
    reason: productRole
      ? "Название и требования вакансии соответствуют продуктовому направлению; балл рассчитан по найденным навыкам."
      : "Есть совпадения по аналитическим навыкам, но направление роли требует дополнительной проверки."
  };
}

export function normalizeHhVacancy(vacancy: HhVacancy): JobUpsert {
  const salarySource = vacancy.salary_range ?? vacancy.salary;
  const currency = salarySource
    ? normalizeCurrency(salarySource.currency)
    : null;
  const salary =
    salarySource?.from !== null &&
    salarySource?.from !== undefined &&
    salarySource.to !== null &&
    salarySource.to !== undefined &&
    currency
      ? {
          min: salarySource.from,
          max: salarySource.to,
          currency
        }
      : undefined;
  const stableId = createHash("sha256")
    .update(`hh:${vacancy.id}`)
    .digest("hex")
    .slice(0, 32);

  return {
    id: `hh-${stableId}`,
    externalId: vacancy.id,
    title: vacancy.name,
    company: vacancy.employer?.name ?? "Компания не указана",
    location: vacancy.area.name,
    workplaceType: classifyWorkplace(vacancy),
    ...(salary ? { salary } : {}),
    publishedAt: vacancy.published_at,
    source: "hh",
    applyUrl: vacancy.alternate_url,
    match: extractMatch(vacancy),
    rawPayload: vacancy
  };
}

export class HhConnector {
  private readonly options: {
    userAgent: string;
    accessToken?: string;
    baseUrl?: string;
    fetch?: typeof globalThis.fetch;
  };

  constructor(
    options: {
      userAgent: string;
      accessToken?: string;
      baseUrl?: string;
      fetch?: typeof globalThis.fetch;
    }
  ) {
    this.options = options;
  }

  async search(input: HhSearchInput) {
    const url = new URL(
      "/vacancies",
      this.options.baseUrl ?? "https://api.hh.ru"
    );
    url.searchParams.set("text", input.text);
    url.searchParams.set("area", input.area ?? "113");
    url.searchParams.set("page", String(input.page ?? 0));
    url.searchParams.set("per_page", String(input.perPage ?? 20));
    url.searchParams.set("order_by", "publication_time");

    const headers: Record<string, string> = {
      Accept: "application/json",
      "HH-User-Agent": this.options.userAgent,
      "User-Agent": this.options.userAgent
    };

    if (this.options.accessToken) {
      headers.Authorization = `Bearer ${this.options.accessToken}`;
    }

    const fetcher = this.options.fetch ?? globalThis.fetch;
    const response = await fetcher(url, { headers });

    if (!response.ok) {
      const code =
        response.status === 403
          ? "captcha_required"
          : response.status === 429
            ? "rate_limited"
            : "request_failed";

      throw new HhApiError(
        `HeadHunter API returned ${response.status}`,
        response.status,
        code
      );
    }

    const payload = (await response.json()) as HhSearchResponse;

    return {
      jobs: payload.items.map(normalizeHhVacancy),
      meta: {
        found: payload.found,
        pages: payload.pages,
        page: payload.page,
        perPage: payload.per_page
      }
    };
  }
}
