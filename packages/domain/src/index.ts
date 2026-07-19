export type WorkplaceType = "remote" | "hybrid" | "onsite";
export type JobSource = "hh" | "greenhouse" | "lever";

export type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  workplaceType: WorkplaceType;
  salary?: {
    min: number;
    max: number;
    currency: "RUB" | "USD" | "EUR";
  };
  publishedAt: string;
  source: JobSource;
  applyUrl: string;
  match: {
    score: number;
    matchedSkills: string[];
    missingSkills: string[];
    reason: string;
  };
};

export type JobFilters = {
  query: string;
  workplace: WorkplaceType | "all";
  minScore: number;
};

export function filterJobs(jobs: Job[], filters: JobFilters): Job[] {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase("ru");

  return jobs
    .filter((job) => {
      const searchableText = [
        job.title,
        job.company,
        job.location,
        ...job.match.matchedSkills,
        ...job.match.missingSkills
      ]
        .join(" ")
        .toLocaleLowerCase("ru");

      const matchesQuery =
        normalizedQuery.length === 0 || searchableText.includes(normalizedQuery);
      const matchesWorkplace =
        filters.workplace === "all" || job.workplaceType === filters.workplace;
      const matchesScore = job.match.score >= filters.minScore;

      return matchesQuery && matchesWorkplace && matchesScore;
    })
    .sort((left, right) => right.match.score - left.match.score);
}

const day = 86_400_000;
const now = Date.now();

export const sampleJobs: Job[] = [
  {
    id: "hh-101",
    title: "Senior Product Analyst",
    company: "Finwave",
    location: "Москва",
    workplaceType: "hybrid",
    salary: { min: 260_000, max: 340_000, currency: "RUB" },
    publishedAt: new Date(now - day).toISOString(),
    source: "hh",
    applyUrl: "https://hh.ru/",
    match: {
      score: 93,
      matchedSkills: ["SQL", "A/B тесты", "Python", "Amplitude"],
      missingSkills: ["Airflow"],
      reason:
        "Почти полное совпадение по продуктовой аналитике, экспериментам и стеку. Airflow указан как желательный навык."
    }
  },
  {
    id: "gh-204",
    title: "Growth Data Analyst",
    company: "Northstar Labs",
    location: "Remote · Europe",
    workplaceType: "remote",
    salary: { min: 3_800, max: 5_200, currency: "EUR" },
    publishedAt: new Date(now - day * 2).toISOString(),
    source: "greenhouse",
    applyUrl: "https://www.greenhouse.com/",
    match: {
      score: 89,
      matchedSkills: ["SQL", "Growth metrics", "Tableau"],
      missingSkills: ["dbt"],
      reason:
        "Роль близка к Product Analyst: основной фокус на воронках, retention и продуктовых экспериментах."
    }
  },
  {
    id: "lever-310",
    title: "Product Insights Analyst",
    company: "Orbit",
    location: "Remote",
    workplaceType: "remote",
    salary: { min: 70_000, max: 90_000, currency: "USD" },
    publishedAt: new Date(now - day * 3).toISOString(),
    source: "lever",
    applyUrl: "https://www.lever.co/",
    match: {
      score: 86,
      matchedSkills: ["Product metrics", "SQL", "Looker"],
      missingSkills: ["English C1"],
      reason:
        "Подходит опыт исследования поведения пользователей. Стоит проверить требование к разговорному английскому."
    }
  },
  {
    id: "hh-118",
    title: "Продуктовый аналитик",
    company: "Самокат Тех",
    location: "Санкт-Петербург",
    workplaceType: "hybrid",
    salary: { min: 230_000, max: 300_000, currency: "RUB" },
    publishedAt: new Date(now - day * 2).toISOString(),
    source: "hh",
    applyUrl: "https://hh.ru/",
    match: {
      score: 84,
      matchedSkills: ["ClickHouse", "SQL", "Эксперименты"],
      missingSkills: ["Superset"],
      reason:
        "Совпадает аналитический стек и опыт экспериментов. Вакансия допускает более широкий уровень seniority."
    }
  },
  {
    id: "gh-226",
    title: "BI Analyst, Product",
    company: "Mosaic Cloud",
    location: "Warsaw",
    workplaceType: "onsite",
    salary: { min: 4_000, max: 5_500, currency: "EUR" },
    publishedAt: new Date(now - day * 4).toISOString(),
    source: "greenhouse",
    applyUrl: "https://www.greenhouse.com/",
    match: {
      score: 78,
      matchedSkills: ["SQL", "Power BI", "Data modeling"],
      missingSkills: ["Polish B1"],
      reason:
        "Навыки подходят, но офисный формат и польский язык могут быть жёсткими ограничениями."
    }
  },
  {
    id: "lever-335",
    title: "Marketing Data Analyst",
    company: "Brightside",
    location: "Berlin · Remote",
    workplaceType: "remote",
    publishedAt: new Date(now - day * 5).toISOString(),
    source: "lever",
    applyUrl: "https://www.lever.co/",
    match: {
      score: 71,
      matchedSkills: ["SQL", "Attribution", "Dashboards"],
      missingSkills: ["Google Ads"],
      reason:
        "Есть пересечение по аналитике воронки, но роль сильнее смещена в маркетинговую атрибуцию."
    }
  }
];
