export type WorkplaceType = "remote" | "hybrid" | "onsite";
export type JobSource =
  | "jobicy"
  | "arbeitnow"
  | "greenhouse"
  | "lever"
  | "ashby";
export type JobRegion = "europe" | "latam" | "apac";
export type JobBoardProvider = "greenhouse" | "lever" | "ashby";

export type JobBoardConfig = {
  provider: JobBoardProvider;
  token: string;
  company: string;
};

export type SearchProfile = {
  role: string;
  regions: JobRegion[];
  aliases: string[];
  boards: JobBoardConfig[];
};

export type CandidateProfile = {
  name: string;
  headline: string;
  skills: string[];
  facts: string[];
};

export type ApplicationDraft = {
  resumeSummary: string;
  coverLetter: string;
  usedSkills: string[];
  skillsToVerify: string[];
};

export type ApplicationStatus =
  | "preparing"
  | "applied"
  | "interview"
  | "offer"
  | "rejected";

export type TrackedApplication = {
  jobId: string;
  title: string;
  company: string;
  applyUrl: string;
  status: ApplicationStatus;
  updatedAt: string;
};

export const emptyCandidateProfile: CandidateProfile = {
  name: "",
  headline: "",
  skills: [],
  facts: []
};

export const defaultSearchProfile: SearchProfile = {
  role: "Product Analyst",
  regions: ["europe", "latam", "apac"],
  aliases: [],
  boards: []
};

export function normalizeJobBoardToken(
  provider: JobBoardProvider,
  value: string
) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) &&
    !trimmed.includes(".") &&
    !trimmed.includes("/")
  ) {
    return trimmed;
  }

  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`
    );
    const segments = url.pathname.split("/").filter(Boolean);

    if (provider === "greenhouse") {
      const boardsIndex = segments.findIndex(
        (segment) => segment.toLowerCase() === "boards"
      );
      if (boardsIndex >= 0) return segments[boardsIndex + 1] ?? "";
      return segments[0] ?? "";
    }

    return segments[0] ?? "";
  } catch {
    return trimmed.replace(/^\/+|\/+$/g, "");
  }
}

export function upsertJobBoard(
  boards: JobBoardConfig[],
  nextBoard: JobBoardConfig
) {
  const key = `${nextBoard.provider}:${nextBoard.token.toLowerCase()}`;
  return [
    ...boards.filter(
      (board) =>
        `${board.provider}:${board.token.toLowerCase()}` !== key
    ),
    nextBoard
  ];
}

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

export function generateApplicationDraft(
  job: Job,
  candidate: CandidateProfile
): ApplicationDraft {
  const candidateSkills = new Map(
    candidate.skills
      .map((skill) => skill.trim())
      .filter(Boolean)
      .map((skill) => [skill.toLowerCase(), skill])
  );
  const usedSkills = job.match.matchedSkills.flatMap((skill) => {
    const verifiedSkill = candidateSkills.get(skill.toLowerCase());
    return verifiedSkill ? [verifiedSkill] : [];
  });
  const skillsToVerify = [
    ...job.match.matchedSkills.filter(
      (skill) => !candidateSkills.has(skill.toLowerCase())
    ),
    ...job.match.missingSkills
  ].filter(
    (skill, index, skills) =>
      skills.findIndex(
        (candidateSkill) =>
          candidateSkill.toLowerCase() === skill.toLowerCase()
      ) === index
  );
  const facts = candidate.facts.map((fact) => fact.trim()).filter(Boolean);
  const displayName = candidate.name.trim() || "Кандидат";
  const headline = candidate.headline.trim();
  const skillLine =
    usedSkills.length > 0
      ? `Ключевые подтверждённые навыки: ${usedSkills.join(", ")}.`
      : "Подтверждённые навыки под эту вакансию пока не добавлены.";
  const factSection =
    facts.length > 0
      ? `Подтверждённый опыт:\n${facts.map((fact) => `• ${fact}`).join("\n")}`
      : "Подтверждённые достижения пока не добавлены.";

  const resumeSummary = [
    displayName,
    headline || `Целевая позиция: ${job.title}`,
    "",
    `Интересующая вакансия: ${job.title} в ${job.company}.`,
    skillLine,
    "",
    factSection
  ].join("\n");

  const introduction = [
    `Меня зовут ${displayName}. Я хочу откликнуться на позицию «${job.title}».`,
    headline ? `Моя текущая специализация: ${headline}.` : ""
  ]
    .filter(Boolean)
    .join("\n");
  const coverLetter = [
    `Здравствуйте, команда ${job.company}!`,
    introduction,
    usedSkills.length > 0
      ? `Для этой роли релевантны мои подтверждённые навыки: ${usedSkills.join(", ")}.`
      : "",
    facts.length > 0
      ? `Из подтверждённого опыта могу отметить:\n${facts
          .map((fact) => `• ${fact}`)
          .join("\n")}`
      : "",
    "Буду рад обсудить задачи роли и взаимное соответствие ожиданий.",
    `С уважением,\n${displayName}`
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    resumeSummary,
    coverLetter,
    usedSkills,
    skillsToVerify
  };
}

export function upsertTrackedApplication(
  applications: TrackedApplication[],
  nextApplication: TrackedApplication
) {
  return [
    nextApplication,
    ...applications.filter(
      (application) => application.jobId !== nextApplication.jobId
    )
  ].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
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
