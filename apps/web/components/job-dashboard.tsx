"use client";

import {
  defaultSearchProfile,
  emptyCandidateProfile,
  expandRoleTitles,
  filterJobs,
  generateApplicationDraft,
  sampleJobs,
  upsertTrackedApplication,
  type ApplicationStatus,
  type ApplicationDraft,
  type CandidateProfile,
  type Job,
  type JobRegion,
  type SearchProfile,
  type TrackedApplication,
  type WorkplaceType
} from "@find-job/domain";
import { useEffect, useMemo, useState } from "react";

const workplaceLabels: Record<WorkplaceType | "all", string> = {
  all: "Любой формат",
  remote: "Удалённо",
  hybrid: "Гибрид",
  onsite: "В офисе"
};

const sourceLabels: Record<Job["source"], string> = {
  jobicy: "Jobicy",
  arbeitnow: "Arbeitnow",
  greenhouse: "Greenhouse",
  lever: "Lever"
};

const regionLabels: Record<JobRegion, string> = {
  europe: "Европа",
  latam: "Латинская Америка",
  apac: "Азия и Океания"
};

const applicationStatusLabels: Record<ApplicationStatus, string> = {
  preparing: "Готовлю документы",
  applied: "Отклик отправлен",
  interview: "Интервью",
  offer: "Оффер",
  rejected: "Отказ"
};

function formatSalary(job: Job) {
  if (!job.salary) return "Зарплата не указана";

  const formatter = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0
  });

  return `${formatter.format(job.salary.min)}–${formatter.format(job.salary.max)} ${job.salary.currency}`;
}

function formatPublishedDate(publishedAt: string) {
  return new Intl.RelativeTimeFormat("ru", { numeric: "auto" }).format(
    -Math.max(1, Math.round((Date.now() - new Date(publishedAt).getTime()) / 86_400_000)),
    "day"
  );
}

export function JobDashboard() {
  const [jobs, setJobs] = useState<Job[]>(sampleJobs);
  const [query, setQuery] = useState("");
  const [workplace, setWorkplace] = useState<WorkplaceType | "all">("all");
  const [minScore, setMinScore] = useState(70);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
  const [dataMode, setDataMode] = useState<"api" | "demo">("demo");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [profile, setProfile] = useState<SearchProfile>(defaultSearchProfile);
  const [draftProfile, setDraftProfile] =
    useState<SearchProfile>(defaultSearchProfile);
  const [aliasInput, setAliasInput] = useState("");
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [candidateProfile, setCandidateProfile] = useState<CandidateProfile>(
    emptyCandidateProfile
  );
  const [candidateSkills, setCandidateSkills] = useState("");
  const [candidateFacts, setCandidateFacts] = useState("");
  const [applicationDraft, setApplicationDraft] =
    useState<ApplicationDraft | null>(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [applications, setApplications] = useState<TrackedApplication[]>([]);
  const [selectedApplicationStatus, setSelectedApplicationStatus] =
    useState<ApplicationStatus>("preparing");
  const [isExporting, setIsExporting] = useState(false);

  async function loadJobs() {
    const apiUrl =
      process.env.NEXT_PUBLIC_API_URL ??
      `${window.location.protocol}//${window.location.hostname}:4000`;

    try {
      const response = await fetch(`${apiUrl}/v1/jobs`);
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const payload = (await response.json()) as { data: Job[] };
      setJobs(payload.data);
      setDataMode("api");
    } catch {
      setDataMode("demo");
    }
  }

  async function runInternationalSearch(searchProfile = profile) {
    const apiUrl =
      process.env.NEXT_PUBLIC_API_URL ??
      `${window.location.protocol}//${window.location.hostname}:4000`;

    setIsRefreshing(true);
    setSearchMessage("");

    try {
      const response = await fetch(`${apiUrl}/v1/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(searchProfile)
      });
      const payload = (await response.json()) as {
        data?: { fetched: number; searches: number; failed: number };
        message?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.message ?? `API returned ${response.status}`);
      }

      await loadJobs();
      setSearchMessage(
        `Поиск завершён: получено ${payload.data.fetched} результатов из ${payload.data.searches} запросов.`
      );
    } catch (error) {
      setSearchMessage(
        error instanceof Error
          ? `Не удалось обновить поиск: ${error.message}`
          : "Не удалось обновить поиск."
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  function openProfileEditor() {
    setDraftProfile(profile);
    setAliasInput(profile.aliases.join(", "));
    setIsProfileOpen(true);
  }

  function saveAndSearch() {
    const nextProfile: SearchProfile = {
      role: draftProfile.role.trim(),
      regions: draftProfile.regions,
      aliases: aliasInput
        .split(",")
        .map((alias) => alias.trim())
        .filter(Boolean)
    };

    setProfile(nextProfile);
    window.localStorage.setItem("find-job-profile", JSON.stringify(nextProfile));
    setIsProfileOpen(false);
    void runInternationalSearch(nextProfile);
  }

  function openJobAnalysis(job: Job) {
    setSelectedJob(job);
    setApplicationDraft(null);
    setDraftMessage("");
    setSelectedApplicationStatus(
      applications.find((application) => application.jobId === job.id)
        ?.status ?? "preparing"
    );

    const storedDraft = window.localStorage.getItem(
      `find-job-draft:${job.id}`
    );
    if (!storedDraft) return;

    try {
      setApplicationDraft(JSON.parse(storedDraft) as ApplicationDraft);
      setDraftMessage("Открыт сохранённый черновик.");
    } catch {
      window.localStorage.removeItem(`find-job-draft:${job.id}`);
    }
  }

  function generateDraft() {
    if (!selectedJob) return;

    const nextCandidate: CandidateProfile = {
      ...candidateProfile,
      skills: candidateSkills
        .split(",")
        .map((skill) => skill.trim())
        .filter(Boolean),
      facts: candidateFacts
        .split("\n")
        .map((fact) => fact.trim())
        .filter(Boolean)
    };
    const draft = generateApplicationDraft(selectedJob, nextCandidate);

    setCandidateProfile(nextCandidate);
    setApplicationDraft(draft);
    setDraftMessage(
      "Черновик собран только из подтверждённых фактов вашего профиля."
    );
    window.localStorage.setItem(
      "find-job-candidate",
      JSON.stringify(nextCandidate)
    );
  }

  function saveDraft() {
    if (!selectedJob || !applicationDraft) return;

    window.localStorage.setItem(
      `find-job-draft:${selectedJob.id}`,
      JSON.stringify(applicationDraft)
    );
    setDraftMessage("Черновик сохранён в этом браузере.");
  }

  function updateApplication(job: Job, status: ApplicationStatus) {
    const nextApplications = upsertTrackedApplication(applications, {
      jobId: job.id,
      title: job.title,
      company: job.company,
      applyUrl: job.applyUrl,
      status,
      updatedAt: new Date().toISOString()
    });

    setApplications(nextApplications);
    setSelectedApplicationStatus(status);
    setDraftMessage(`Статус обновлён: ${applicationStatusLabels[status]}.`);
    window.localStorage.setItem(
      "find-job-applications",
      JSON.stringify(nextApplications)
    );
  }

  function removeApplication(jobId: string) {
    const nextApplications = applications.filter(
      (application) => application.jobId !== jobId
    );

    setApplications(nextApplications);

    if (nextApplications.length > 0) {
      window.localStorage.setItem(
        "find-job-applications",
        JSON.stringify(nextApplications)
      );
    } else {
      window.localStorage.removeItem("find-job-applications");
    }

    if (selectedJob?.id === jobId) {
      setDraftMessage("Вакансия удалена из трекера откликов.");
    }
  }

  async function exportApplication(format: "docx" | "pdf") {
    if (!selectedJob || !applicationDraft) return;

    const apiUrl =
      process.env.NEXT_PUBLIC_API_URL ??
      `${window.location.protocol}//${window.location.hostname}:4000`;
    setIsExporting(true);
    setDraftMessage("");

    try {
      const response = await fetch(
        `${apiUrl}/v1/documents/export?format=${format}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateName: candidateProfile.name,
            jobTitle: selectedJob.title,
            company: selectedJob.company,
            location: selectedJob.location,
            resumeSummary: applicationDraft.resumeSummary,
            coverLetter: applicationDraft.coverLetter
          })
        }
      );
      if (!response.ok) throw new Error(`API returned ${response.status}`);

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const fileName = encodedName
        ? decodeURIComponent(encodedName)
        : `application.${format}`;
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      window.URL.revokeObjectURL(url);
      setDraftMessage(`Файл ${format.toUpperCase()} подготовлен.`);
    } catch (error) {
      setDraftMessage(
        error instanceof Error
          ? `Не удалось экспортировать файл: ${error.message}`
          : "Не удалось экспортировать файл."
      );
    } finally {
      setIsExporting(false);
    }
  }

  function clearCandidateData() {
    window.localStorage.removeItem("find-job-candidate");
    if (selectedJob) {
      window.localStorage.removeItem(`find-job-draft:${selectedJob.id}`);
    }
    setCandidateProfile(emptyCandidateProfile);
    setCandidateSkills("");
    setCandidateFacts("");
    setApplicationDraft(null);
    setDraftMessage("Локальные данные кандидата и черновик удалены.");
  }

  useEffect(() => {
    const controller = new AbortController();
    const apiUrl =
      process.env.NEXT_PUBLIC_API_URL ??
      `${window.location.protocol}//${window.location.hostname}:4000`;

    fetch(`${apiUrl}/v1/jobs`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        return response.json() as Promise<{ data: Job[] }>;
      })
      .then((payload) => {
        setJobs(payload.data);
        setDataMode("api");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDataMode("demo");
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const storedApplications = window.localStorage.getItem(
      "find-job-applications"
    );
    if (!storedApplications) return;

    try {
      const parsed = JSON.parse(storedApplications) as TrackedApplication[];
      if (Array.isArray(parsed)) {
        const timer = window.setTimeout(() => setApplications(parsed), 0);
        return () => window.clearTimeout(timer);
      }
    } catch {
      window.localStorage.removeItem("find-job-applications");
    }
  }, []);

  useEffect(() => {
    const storedCandidate = window.localStorage.getItem("find-job-candidate");
    if (!storedCandidate) return;

    let parsed: CandidateProfile;
    try {
      parsed = JSON.parse(storedCandidate) as CandidateProfile;
    } catch {
      window.localStorage.removeItem("find-job-candidate");
      return;
    }

    if (
      typeof parsed.name === "string" &&
      typeof parsed.headline === "string" &&
      Array.isArray(parsed.skills) &&
      Array.isArray(parsed.facts)
    ) {
      const timer = window.setTimeout(() => {
        setCandidateProfile(parsed);
        setCandidateSkills(parsed.skills.join(", "));
        setCandidateFacts(parsed.facts.join("\n"));
      }, 0);

      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    const storedProfile = window.localStorage.getItem("find-job-profile");
    if (!storedProfile) return;

    let parsed: SearchProfile;
    try {
      parsed = JSON.parse(storedProfile) as SearchProfile;
    } catch {
      window.localStorage.removeItem("find-job-profile");
      return;
    }

    if (
      typeof parsed.role === "string" &&
      Array.isArray(parsed.regions) &&
      Array.isArray(parsed.aliases)
    ) {
      const timer = window.setTimeout(() => {
        setProfile(parsed);
        setDraftProfile(parsed);
      }, 0);

      return () => window.clearTimeout(timer);
    }
  }, []);

  const filteredJobs = useMemo(
    () => filterJobs(jobs, { query, workplace, minScore }),
    [jobs, query, workplace, minScore]
  );

  const averageScore = filteredJobs.length
    ? Math.round(
        filteredJobs.reduce((total, job) => total + job.match.score, 0) /
          filteredJobs.length
      )
    : 0;

  function toggleSaved(jobId: string) {
    setSavedIds((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Find Job">
          <span className="brand-mark">FJ</span>
          <span>Find Job</span>
        </a>

        <nav className="main-nav" aria-label="Основная навигация">
          <a className="nav-item nav-item-active" href="#">
            <span>⌕</span>
            Вакансии
            <span className="nav-badge">{jobs.length}</span>
          </a>
          <a className="nav-item" href="#saved">
            <span>☆</span>
            Сохранённые
            {savedIds.size > 0 && <span className="nav-badge">{savedIds.size}</span>}
          </a>
          <a className="nav-item" href="#applications">
            <span>↗</span>
            Отклики
            {applications.length > 0 && (
              <span className="nav-badge">{applications.length}</span>
            )}
          </a>
          <a className="nav-item" href="#documents">
            <span>▤</span>
            Документы
          </a>
        </nav>

        <div className="sidebar-spacer" />

        <div className="search-profile">
          <div className="profile-label">Активный поиск</div>
          <strong>{profile.role}</strong>
          <span>{profile.regions.map((region) => regionLabels[region]).join(" · ")}</span>
          <button type="button" onClick={openProfileEditor}>
            Настроить
          </button>
        </div>

        <div className="user-card">
          <span className="avatar">АК</span>
          <span>
            <strong>Антон</strong>
            <small>Профиль заполнен на 72%</small>
          </span>
          <button type="button" aria-label="Открыть меню профиля">
            ···
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Персональная лента</p>
            <h1>Вакансии для вас</h1>
          </div>
          <div className="topbar-actions">
            <span className={`connection-pill connection-pill-${dataMode}`}>
              <span />
              {dataMode === "api" ? "API подключён" : "Демо-данные"}
            </span>
            <button
              className="secondary-button"
              disabled={isRefreshing}
              onClick={() => void runInternationalSearch()}
              type="button"
            >
              {isRefreshing ? "Ищем по миру…" : "Найти вакансии"}
            </button>
          </div>
        </header>

        {isProfileOpen && (
          <section className="profile-editor" aria-label="Настройка поиска">
            <div className="profile-editor-heading">
              <div>
                <p className="eyebrow">Профиль поиска</p>
                <h2>Кем вы хотите работать?</h2>
              </div>
              <button
                aria-label="Закрыть настройку"
                className="profile-close"
                onClick={() => setIsProfileOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <div className="profile-fields">
              <label className="field profile-role-field">
                <span>Желаемая должность</span>
                <input
                  onChange={(event) =>
                    setDraftProfile((current) => ({
                      ...current,
                      role: event.target.value
                    }))
                  }
                  placeholder="Например, Product Analyst"
                  type="text"
                  value={draftProfile.role}
                />
              </label>

              <label className="field profile-alias-field">
                <span>Дополнительные названия через запятую</span>
                <input
                  onChange={(event) => setAliasInput(event.target.value)}
                  placeholder="Growth Analyst, Product Insights"
                  type="text"
                  value={aliasInput}
                />
              </label>
            </div>

            <fieldset className="region-picker">
              <legend>Где искать</legend>
              {(Object.keys(regionLabels) as JobRegion[]).map((region) => (
                <label key={region}>
                  <input
                    checked={draftProfile.regions.includes(region)}
                    onChange={(event) =>
                      setDraftProfile((current) => ({
                        ...current,
                        regions: event.target.checked
                          ? [...current.regions, region]
                          : current.regions.filter(
                              (candidate) => candidate !== region
                            )
                      }))
                    }
                    type="checkbox"
                  />
                  <span>{regionLabels[region]}</span>
                </label>
              ))}
            </fieldset>

            <div className="profile-suggestions">
              <span>Будем искать также:</span>
              <p>
                {expandRoleTitles(draftProfile.role, [
                  ...aliasInput.split(",")
                ])
                  .slice(1)
                  .join(" · ") || "добавьте должность, чтобы увидеть варианты"}
              </p>
            </div>

            <div className="profile-actions">
              <button
                className="secondary-button"
                onClick={() => setIsProfileOpen(false)}
                type="button"
              >
                Отмена
              </button>
              <button
                className="primary-button"
                disabled={
                  draftProfile.role.trim().length < 2 ||
                  draftProfile.regions.length === 0 ||
                  isRefreshing
                }
                onClick={saveAndSearch}
                type="button"
              >
                Сохранить и найти
              </button>
            </div>
          </section>
        )}

        {searchMessage && (
          <div className="search-message" role="status">
            {searchMessage}
          </div>
        )}

        <section className="summary-grid" aria-label="Сводка">
          <article className="summary-card summary-card-accent">
            <span>Новых сегодня</span>
            <strong>{Math.min(filteredJobs.length, 4)}</strong>
            <small>по вашему профилю</small>
          </article>
          <article className="summary-card">
            <span>Средний match</span>
            <strong>{averageScore}%</strong>
            <small>среди результатов</small>
          </article>
          <article className="summary-card">
            <span>Сохранено</span>
            <strong>{savedIds.size}</strong>
            <small>для детального разбора</small>
          </article>
          <article className="summary-card">
            <span>Источников</span>
            <strong>{new Set(jobs.map((job) => job.source)).size}</strong>
            <small>синхронизировано</small>
          </article>
        </section>

        <section className="content-grid">
          <aside className="filters">
            <div className="filter-heading">
              <h2>Фильтры</h2>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setWorkplace("all");
                  setMinScore(0);
                }}
              >
                Сбросить
              </button>
            </div>

            <label className="field">
              <span>Поиск</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Роль, компания, навык"
                type="search"
                value={query}
              />
            </label>

            <label className="field">
              <span>Формат работы</span>
              <select
                onChange={(event) =>
                  setWorkplace(event.target.value as WorkplaceType | "all")
                }
                value={workplace}
              >
                {Object.entries(workplaceLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field range-field">
              <span>
                Match score <strong>от {minScore}%</strong>
              </span>
              <input
                max="95"
                min="0"
                onChange={(event) => setMinScore(Number(event.target.value))}
                step="5"
                type="range"
                value={minScore}
              />
              <span className="range-scale">
                <small>0%</small>
                <small>95%</small>
              </span>
            </label>

            <div className="filter-note">
              <span>✨</span>
              <p>
                <strong>Почему эти вакансии?</strong>
                Ищем «{profile.role}» и близкие названия. Вакансии другого типа
                роли не проходят порог только за счёт совпавших навыков.
              </p>
            </div>
          </aside>

          <div className="job-feed">
            <div className="feed-heading">
              <div>
                <h2>{filteredJobs.length} подходящих вакансий</h2>
                <p>Отсортировано по соответствию вашему профилю</p>
              </div>
              <select aria-label="Сортировка" defaultValue="match">
                <option value="match">Сначала подходящие</option>
                <option value="fresh">Сначала свежие</option>
                <option value="salary">По зарплате</option>
              </select>
            </div>

            {filteredJobs.length === 0 ? (
              <div className="empty-state">
                <span>⌕</span>
                <h3>Ничего не нашлось</h3>
                <p>Попробуйте снизить match score или убрать часть запроса.</p>
              </div>
            ) : (
              filteredJobs.map((job) => {
                const isSaved = savedIds.has(job.id);

                return (
                  <article className="job-card" key={job.id}>
                    <div className="company-logo" aria-hidden="true">
                      {job.company
                        .split(" ")
                        .map((part) => part[0])
                        .join("")
                        .slice(0, 2)}
                    </div>

                    <div className="job-main">
                      <div className="job-title-row">
                        <div>
                          <div className="job-meta-top">
                            <span>{sourceLabels[job.source]}</span>
                            <span>·</span>
                            <span>{formatPublishedDate(job.publishedAt)}</span>
                          </div>
                          <h3>{job.title}</h3>
                          <p>
                            {job.company} · {job.location} ·{" "}
                            {workplaceLabels[job.workplaceType]}
                          </p>
                        </div>
                        <div
                          className={`match-score match-score-${Math.floor(
                            job.match.score / 10
                          )}`}
                        >
                          <strong>{job.match.score}%</strong>
                          <span>match</span>
                        </div>
                      </div>

                      <div className="salary">{formatSalary(job)}</div>

                      <div className="skills">
                        {job.match.matchedSkills.map((skill) => (
                          <span className="skill skill-match" key={skill}>
                            ✓ {skill}
                          </span>
                        ))}
                        {job.match.missingSkills.slice(0, 1).map((skill) => (
                          <span className="skill skill-gap" key={skill}>
                            △ {skill}
                          </span>
                        ))}
                      </div>

                      <div className="match-reason">
                        <span>✨</span>
                        <p>{job.match.reason}</p>
                      </div>

                      <div className="job-actions">
                        <button
                          className="primary-button"
                          type="button"
                          onClick={() => openJobAnalysis(job)}
                        >
                          Разобрать вакансию
                        </button>
                        <a href={job.applyUrl} target="_blank" rel="noreferrer">
                          Открыть оригинал ↗
                        </a>
                        <button
                          className={`save-button ${isSaved ? "save-button-active" : ""}`}
                          type="button"
                          aria-label={
                            isSaved ? "Удалить из сохранённых" : "Сохранить вакансию"
                          }
                          onClick={() => toggleSaved(job.id)}
                        >
                          {isSaved ? "★" : "☆"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>

        <section className="application-tracker" id="applications">
          <div className="tracker-heading">
            <div>
              <p className="eyebrow">Воронка</p>
              <h2>Отклики</h2>
            </div>
            <span>{applications.length} вакансий</span>
          </div>

          {applications.length === 0 ? (
            <p className="tracker-empty">
              Разберите вакансию и добавьте её в отклики — статус появится здесь.
            </p>
          ) : (
            <div className="tracker-list">
              {applications.map((application) => (
                <article className="tracker-row" key={application.jobId}>
                  <div>
                    <strong>{application.title}</strong>
                    <span>{application.company}</span>
                  </div>
                  <select
                    aria-label={`Статус ${application.title}`}
                    onChange={(event) => {
                      const status = event.target.value as ApplicationStatus;
                      const nextApplications = upsertTrackedApplication(
                        applications,
                        {
                          ...application,
                          status,
                          updatedAt: new Date().toISOString()
                        }
                      );
                      setApplications(nextApplications);
                      window.localStorage.setItem(
                        "find-job-applications",
                        JSON.stringify(nextApplications)
                      );
                    }}
                    value={application.status}
                  >
                    {Object.entries(applicationStatusLabels).map(
                      ([status, label]) => (
                        <option key={status} value={status}>
                          {label}
                        </option>
                      )
                    )}
                  </select>
                  <a
                    href={application.applyUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Открыть ↗
                  </a>
                  <button
                    className="tracker-delete"
                    onClick={() => removeApplication(application.jobId)}
                    type="button"
                  >
                    Удалить
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      {selectedJob && (
        <div className="application-overlay" role="presentation">
          <section
            aria-label={`Разбор вакансии ${selectedJob.title}`}
            className="application-panel"
          >
            <header className="application-header">
              <div>
                <p className="eyebrow">Подготовка отклика</p>
                <h2>{selectedJob.title}</h2>
                <span>
                  {selectedJob.company} · {selectedJob.location}
                </span>
              </div>
              <button
                aria-label="Закрыть разбор вакансии"
                className="profile-close"
                onClick={() => setSelectedJob(null)}
                type="button"
              >
                ×
              </button>
            </header>

            <div className="application-scroll">
              <section className="vacancy-analysis">
                <div>
                  <span>Match</span>
                  <strong>{selectedJob.match.score}%</strong>
                </div>
                <p>{selectedJob.match.reason}</p>
              </section>

              <section className="candidate-editor">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Подтверждённые данные</p>
                    <h3>Факты о кандидате</h3>
                  </div>
                  <div className="candidate-heading-actions">
                    <span className="safe-badge">Без выдуманных фактов</span>
                    <button
                      className="clear-data-button"
                      onClick={clearCandidateData}
                      type="button"
                    >
                      Удалить данные
                    </button>
                  </div>
                </div>

                <div className="candidate-fields">
                  <label className="field">
                    <span>Имя</span>
                    <input
                      onChange={(event) =>
                        setCandidateProfile((current) => ({
                          ...current,
                          name: event.target.value
                        }))
                      }
                      placeholder="Ваше имя"
                      type="text"
                      value={candidateProfile.name}
                    />
                  </label>
                  <label className="field">
                    <span>Текущая специализация</span>
                    <input
                      onChange={(event) =>
                        setCandidateProfile((current) => ({
                          ...current,
                          headline: event.target.value
                        }))
                      }
                      placeholder="Например, Product Analyst"
                      type="text"
                      value={candidateProfile.headline}
                    />
                  </label>
                </div>

                <label className="field">
                  <span>Подтверждённые навыки через запятую</span>
                  <input
                    onChange={(event) => setCandidateSkills(event.target.value)}
                    placeholder="SQL, Python, Tableau"
                    type="text"
                    value={candidateSkills}
                  />
                </label>

                <label className="field">
                  <span>Достижения — одно на строку</span>
                  <textarea
                    onChange={(event) => setCandidateFacts(event.target.value)}
                    placeholder="Укажите только реальные, проверяемые факты"
                    rows={4}
                    value={candidateFacts}
                  />
                </label>

                <button
                  className="primary-button generate-button"
                  disabled={candidateProfile.name.trim().length < 2}
                  onClick={generateDraft}
                  type="button"
                >
                  Собрать документы
                </button>
              </section>

              {applicationDraft && (
                <section className="document-editor">
                  {applicationDraft.skillsToVerify.length > 0 && (
                    <div className="verification-note">
                      <strong>Не добавлено без подтверждения:</strong>
                      <span>
                        {applicationDraft.skillsToVerify.join(" · ")}
                      </span>
                    </div>
                  )}

                  <label className="document-field">
                    <span>Адаптированное резюме</span>
                    <textarea
                      onChange={(event) =>
                        setApplicationDraft((current) =>
                          current
                            ? {
                                ...current,
                                resumeSummary: event.target.value
                              }
                            : current
                        )
                      }
                      rows={10}
                      value={applicationDraft.resumeSummary}
                    />
                  </label>

                  <label className="document-field">
                    <span>Сопроводительное письмо</span>
                    <textarea
                      onChange={(event) =>
                        setApplicationDraft((current) =>
                          current
                            ? { ...current, coverLetter: event.target.value }
                            : current
                        )
                      }
                      rows={14}
                      value={applicationDraft.coverLetter}
                    />
                  </label>

                  <div className="document-actions">
                    <button
                      className="secondary-button"
                      onClick={saveDraft}
                      type="button"
                    >
                      Сохранить черновик
                    </button>
                    <button
                      className="export-button"
                      disabled={isExporting}
                      onClick={() => void exportApplication("docx")}
                      type="button"
                    >
                      Скачать DOCX
                    </button>
                    <button
                      className="export-button"
                      disabled={isExporting}
                      onClick={() => void exportApplication("pdf")}
                      type="button"
                    >
                      Скачать PDF
                    </button>
                  </div>

                  <div className="application-status-control">
                    <label>
                      <span>Статус отклика</span>
                      <select
                        onChange={(event) =>
                          setSelectedApplicationStatus(
                            event.target.value as ApplicationStatus
                          )
                        }
                        value={selectedApplicationStatus}
                      >
                        {Object.entries(applicationStatusLabels).map(
                          ([status, label]) => (
                            <option key={status} value={status}>
                              {label}
                            </option>
                          )
                        )}
                      </select>
                    </label>
                    <button
                      className="primary-button"
                      onClick={() =>
                        updateApplication(
                          selectedJob,
                          selectedApplicationStatus
                        )
                      }
                      type="button"
                    >
                      Добавить в отклики
                    </button>
                  </div>
                </section>
              )}

              {draftMessage && (
                <div className="search-message" role="status">
                  {draftMessage}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
