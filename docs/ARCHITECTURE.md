# Find Job — архитектура MVP

## 1. Архитектурные принципы

- модульный монолит для первой версии;
- асинхронный сбор и обработка вакансий;
- отдельный адаптер для каждого источника;
- идемпотентный импорт;
- детерминированные правила рядом с LLM;
- полная трассируемость происхождения данных;
- внешнее действие только с подтверждением пользователя;
- возможность вынести коннекторы и AI-задачи в отдельные сервисы позже.

## 2. Контейнеры

```text
Browser
  │
  ▼
Next.js Web
  │
  ▼
NestJS API ───────────────► PostgreSQL + pgvector
  │                              │
  ├──────────────► Object Storage│
  │                              │
  ▼                              │
Redis / BullMQ                   │
  │                              │
  ├── Source connectors ─────────┘
  ├── Normalize and deduplicate
  ├── Vacancy extraction
  ├── Fit scoring
  ├── Document generation
  └── Notifications
```

Playwright работает как отдельный локальный или изолированный процесс для
assisted-fill. Сессия видима пользователю и не хранит пароль в основной базе.

## 3. Структура монорепозитория

```text
apps/
  web/                 Next.js
  api/                 NestJS HTTP API
  worker/              BullMQ consumers
packages/
  db/                  schema, migrations, repositories
  domain/              entities and business rules
  connectors/          source adapter interface
  matching/            extraction and scoring
  documents/           resume and cover-letter generation
  ui/                  shared components
  config/              typed environment configuration
  observability/       logging, metrics, tracing
infra/
  docker/
  migrations/
docs/
```

## 4. Доменные модули

### Identity

Регистрация, сессии, роли, согласия, удаление данных.

### Candidate

Профиль, подтверждённые факты, опыт, навыки, языки, предпочтения и ограничения.

### Search

Поисковые профили, названия ролей, синонимы, фильтры и расписание.

### Sources

Конфигурации источников, курсоры синхронизации, лимиты и ошибки.

### Jobs

Сырые записи, нормализованные вакансии, группы дублей, компании и локации.

### Matching

Извлечённые требования, признаки соответствия, правила, баллы и объяснения.

### Documents

Базовые резюме, версии, письма, шаблоны, экспорт и происхождение утверждений.

### Applications

Подготовка, подтверждение, отправка/переход, статусы, события и заметки.

### Notifications

Настройки, события и доставка.

## 5. Интерфейс коннектора

```ts
interface JobSourceConnector {
  readonly source: SourceCode;

  validateConfig(config: unknown): Promise<ValidationResult>;

  fetchPage(input: {
    query: SourceQuery;
    cursor?: string;
    signal: AbortSignal;
  }): Promise<{
    items: RawJob[];
    nextCursor?: string;
    rateLimit?: RateLimitState;
  }>;

  fetchDetails?(externalId: string): Promise<RawJob>;

  mapToCanonical(raw: RawJob): Promise<CanonicalJobInput>;

  healthCheck(): Promise<ConnectorHealth>;
}
```

Требования:

- повторная обработка одного ответа не создаёт новую вакансию;
- сырой ответ сохраняется с версией схемы и сроком хранения;
- ошибки одной записи не отменяют страницу целиком;
- поддерживаются backoff, jitter, лимиты и `Retry-After`;
- лог содержит source, sync run и external ID, но не персональные данные.

Текущий вертикальный срез реализует пять адаптеров: Jobicy, Arbeitnow,
Greenhouse Job Board API, Lever Postings API и Ashby Job Postings API.
ATS-источники опрашиваются по публичным доскам работодателей; сбой одной доски
изолируется и не отменяет результаты остальных компаний. Пользовательский каталог
досок хранится в браузере вместе с поисковым профилем и передаётся в `/v1/search`.

## 6. Основные таблицы

### Пользователь и профиль

```text
users
candidate_profiles
candidate_facts
experiences
educations
skills
candidate_skills
job_preferences
search_profiles
search_role_aliases
consent_events
```

`candidate_facts` хранит атомарные утверждения и их происхождение:

```text
id
candidate_profile_id
fact_type
value_json
source_document_id
source_fragment
verification_status
verified_at
```

### Вакансии

```text
job_sources
source_sync_runs
raw_job_records
companies
locations
jobs
job_locations
job_skills
job_requirements
job_source_links
duplicate_groups
```

Уникальные ограничения:

```text
(source_id, external_id)
(source_id, canonical_url_hash)
```

### Сопоставление и документы

```text
job_matches
match_features
base_resumes
resume_versions
resume_claims
cover_letters
generated_assets
```

Каждое утверждение в `resume_claims` ссылается на `candidate_facts`. Отсутствие
ссылки блокирует экспорт до ручного подтверждения.

### Отклики

```text
applications
application_documents
application_answers
application_events
reminders
```

`application_events` — append-only журнал. Текущий статус в `applications`
является проекцией журнала для быстрых запросов.

## 7. Поток обработки вакансии

```text
scheduled search
  → connector fetch
  → raw record
  → canonical mapping
  → exact identity check
  → fuzzy duplicate candidate search
  → canonical job upsert
  → requirement extraction
  → deterministic feature calculation
  → fit score
  → notification decision
```

Статусы фоновой задачи:

```text
queued → running → completed
                 ├── partial
                 ├── retrying
                 └── failed
```

## 8. AI-контур

### Допустимые задачи LLM

- извлечение структуры из текста вакансии;
- классификация роли и seniority;
- предложение синонимов;
- сопоставление требований с подтверждёнными фактами;
- черновики формулировок и писем;
- краткое объяснение результата.

### Недопустимые автономные решения

- создание фактов биографии;
- ответ на чувствительный вопрос;
- изменение жёстких предпочтений;
- отправка внешней формы;
- принятие юридического согласия;
- автоматическое сокрытие вакансии только по выводу модели.

### Контроль качества

- структурированный JSON-ответ по версии схемы;
- валидация до записи;
- хранение model ID, prompt version и входного hash;
- кэширование по hash;
- повторяемый расчёт score вне модели;
- набор эталонных вакансий и профилей для regression tests.

## 9. API первой версии

```text
POST   /v1/profile/import
GET    /v1/profile
PATCH  /v1/profile
POST   /v1/profile/facts/:id/verify

POST   /v1/search-profiles
GET    /v1/search-profiles
POST   /v1/search-profiles/:id/run

GET    /v1/jobs
GET    /v1/jobs/:id
POST   /v1/jobs/:id/save
POST   /v1/jobs/:id/hide
POST   /v1/jobs/:id/recalculate-match

POST   /v1/jobs/:id/resume
POST   /v1/jobs/:id/cover-letter
GET    /v1/documents/:id
PATCH  /v1/documents/:id
POST   /v1/documents/:id/export

POST   /v1/applications
GET    /v1/applications
GET    /v1/applications/:id
POST   /v1/applications/:id/confirm
POST   /v1/applications/:id/events
```

Все изменяющие POST-запросы, которые могут повториться из-за сети, принимают
`Idempotency-Key`.

## 10. Наблюдаемость

Минимальные метрики:

- длительность и результат sync run;
- число прочитанных, новых, обновлённых и ошибочных записей;
- lag по источнику;
- rate-limit responses;
- размер очередей и возраст самой старой задачи;
- время extraction/matching;
- расход токенов по типу задачи;
- ошибки экспорта;
- подтверждённые внешние действия.

Для каждой вакансии интерфейс поддержки должен показывать путь от raw record до
нормализованной записи и итогового score.

## 11. Развёртывание

### Локально

Docker Compose:

- PostgreSQL;
- Redis;
- MinIO;
- web;
- api;
- worker.

### Закрытый тест

- managed PostgreSQL;
- managed Redis;
- S3-compatible storage;
- контейнеры web/api/worker;
- секреты среды;
- ежедневные резервные копии;
- отдельные staging и production.

## 12. Решения для последующего масштабирования

Выносить компонент в отдельный сервис только при измеренной необходимости:

- коннекторы — при независимых лимитах и масштабировании;
- matching — при высокой стоимости вычислений;
- документы — при отдельном SLA;
- browser automation — сразу изолировать из-за риска и ресурсов;
- search index — добавить OpenSearch/Elasticsearch после исчерпания PostgreSQL.
