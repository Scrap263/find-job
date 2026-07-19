"use client";

import {
  filterJobs,
  sampleJobs,
  type Job,
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
  hh: "HeadHunter",
  greenhouse: "Greenhouse",
  lever: "Lever"
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
          </a>
          <a className="nav-item" href="#documents">
            <span>▤</span>
            Документы
          </a>
        </nav>

        <div className="sidebar-spacer" />

        <div className="search-profile">
          <div className="profile-label">Активный поиск</div>
          <strong>Product Analyst</strong>
          <span>Москва · Remote</span>
          <button type="button">Настроить</button>
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
            <button className="secondary-button" type="button">
              Обновить поиск
            </button>
          </div>
        </header>

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
                Роль расширена до Product, Growth и Data Analyst с продуктовыми
                метриками.
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
                          onClick={() => toggleSaved(job.id)}
                        >
                          {isSaved ? "Сохранено" : "Разобрать вакансию"}
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
      </section>
    </main>
  );
}
