export type WorkplaceType = "remote" | "hybrid" | "onsite";
export type JobSource = "jobicy" | "arbeitnow" | "greenhouse" | "lever";
export type JobRegion = "europe" | "latam" | "apac";

export type SearchProfile = {
  role: string;
  regions: JobRegion[];
  aliases: string[];
};

export const defaultSearchProfile: SearchProfile = {
  role: "Product Analyst",
  regions: ["europe", "latam", "apac"],
  aliases: []
};

const roleAliasGroups = [
  {
    patterns: ["product analyst", "product data analyst"],
    titles: [
      "Product Analyst",
      "Product Data Analyst",
      "Growth Analyst",
      "Product Insights Analyst",
      "BI Analyst"
    ]
  },
  {
    patterns: ["data analyst", "business intelligence analyst", "bi analyst"],
    titles: [
      "Data Analyst",
      "Business Intelligence Analyst",
      "BI Analyst",
      "Insights Analyst",
      "Reporting Analyst"
    ]
  },
  {
    patterns: ["frontend developer", "front end developer", "frontend engineer"],
    titles: [
      "Frontend Developer",
      "Frontend Engineer",
      "React Developer",
      "UI Engineer",
      "Web Developer"
    ]
  },
  {
    patterns: ["backend developer", "backend engineer", "back end developer"],
    titles: [
      "Backend Developer",
      "Backend Engineer",
      "Software Engineer",
      "API Engineer",
      "Platform Engineer"
    ]
  },
  {
    patterns: ["product manager", "product owner"],
    titles: [
      "Product Manager",
      "Product Owner",
      "Technical Product Manager",
      "Growth Product Manager",
      "Product Lead"
    ]
  }
] as const;

export function expandRoleTitles(role: string, customAliases: string[] = []) {
  const normalizedRole = role.trim().replace(/\s+/g, " ");
  const roleKey = normalizedRole.toLowerCase();
  const group = roleAliasGroups.find(({ patterns }) =>
    patterns.some((pattern) => roleKey === pattern || roleKey.includes(pattern))
  );

  return [
    normalizedRole,
    ...(group?.titles ?? []),
    ...customAliases.map((alias) => alias.trim())
  ].filter(
    (title, index, titles) =>
      title.length >= 2 &&
      titles.findIndex(
        (candidate) => candidate.toLowerCase() === title.toLowerCase()
      ) === index
  );
}

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
    id: "jobicy-101",
    title: "Senior Product Analyst",
    company: "Finwave",
    location: "Lisbon",
    workplaceType: "hybrid",
    salary: { min: 65_000, max: 82_000, currency: "EUR" },
    publishedAt: new Date(now - day).toISOString(),
    source: "jobicy",
    applyUrl: "https://jobicy.com/jobs",
    match: {
      score: 93,
      matchedSkills: ["SQL", "A/B тесты", "Python", "Amplitude"],
      missingSkills: ["Airflow"],
      reason:
        "Почти полное совпадение по продуктовой аналитике, экспериментам и стеку. Airflow указан как желательный навык."
    }
  },
  {
    id: "arbeitnow-204",
    title: "Growth Data Analyst",
    company: "Northstar Labs",
    location: "Remote · Europe",
    workplaceType: "remote",
    salary: { min: 3_800, max: 5_200, currency: "EUR" },
    publishedAt: new Date(now - day * 2).toISOString(),
    source: "arbeitnow",
    applyUrl: "https://www.arbeitnow.com/",
    match: {
      score: 89,
      matchedSkills: ["SQL", "Growth metrics", "Tableau"],
      missingSkills: ["dbt"],
      reason:
        "Роль близка к Product Analyst: основной фокус на воронках, retention и продуктовых экспериментах."
    }
  },
  {
    id: "jobicy-310",
    title: "Product Insights Analyst",
    company: "Orbit",
    location: "Remote · LATAM",
    workplaceType: "remote",
    salary: { min: 70_000, max: 90_000, currency: "USD" },
    publishedAt: new Date(now - day * 3).toISOString(),
    source: "jobicy",
    applyUrl: "https://jobicy.com/jobs",
    match: {
      score: 86,
      matchedSkills: ["Product metrics", "SQL", "Looker"],
      missingSkills: ["English C1"],
      reason:
        "Подходит опыт исследования поведения пользователей. Стоит проверить требование к разговорному английскому."
    }
  },
  {
    id: "jobicy-118",
    title: "Product Analyst, Data Platform",
    company: "NovaPay",
    location: "São Paulo",
    workplaceType: "hybrid",
    salary: { min: 42_000, max: 58_000, currency: "USD" },
    publishedAt: new Date(now - day * 2).toISOString(),
    source: "jobicy",
    applyUrl: "https://jobicy.com/jobs",
    match: {
      score: 84,
      matchedSkills: ["ClickHouse", "SQL", "Experiments"],
      missingSkills: ["Superset"],
      reason:
        "The analytics stack and experimentation experience match; the role is open to candidates across LATAM."
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
    source: "arbeitnow",
    applyUrl: "https://www.arbeitnow.com/",
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
    location: "Singapore · Remote",
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
