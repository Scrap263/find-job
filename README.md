# Find Job

Персональный сервис поиска работы: собирает вакансии из разных источников,
объединяет дубликаты, оценивает соответствие профилю кандидата и помогает
подготовить резюме и сопроводительное письмо для конкретной вакансии.

## Состояние проекта

Реализован первый вертикальный срез MVP:

- веб-дашборд с адаптивным интерфейсом;
- единая модель вакансии;
- международный поиск Jobicy, Arbeitnow, Greenhouse, Lever и Ashby по Европе, LATAM и APAC;
- редактируемый поисковый профиль и синонимы должностей;
- поиск, формат работы и порог соответствия;
- объяснимый role-aware match score;
- локальное сохранение вакансий в рамках сессии;
- панель разбора вакансии;
- grounded-черновики резюме и сопроводительного письма;
- экспорт пакета документов в DOCX и PDF;
- локальный трекер откликов со статусами от подготовки до оффера;
- локальное сохранение и полное удаление данных кандидата;
- Node.js API с `/health`, `/v1/jobs` и `/v1/search`;
- regression-тесты фильтрации, скоринга и документов.

- [Техническое задание](docs/PRODUCT_SPEC.md)
- [Архитектура](docs/ARCHITECTURE.md)
- [План разработки](docs/ROADMAP.md)

## Принцип MVP

Сервис автоматизирует поиск, анализ и подготовку документов. Отправка отклика
происходит только после явного подтверждения пользователя. Если источник не
предоставляет подходящий публичный API, сервис открывает оригинальную форму
работодателя и помогает заполнить её, но не обходит CAPTCHA и ограничения сайта.

## Предлагаемый стек

- Frontend: Next.js, TypeScript, Tailwind CSS
- Backend MVP: Node.js HTTP API, TypeScript
- Database: PostgreSQL + pgvector
- Очереди и планировщик: Redis + BullMQ
- Файлы: S3-совместимое хранилище
- Автоматизация форм: Playwright, только в контролируемой сессии пользователя
- Монорепозиторий: npm workspaces

## Локальный запуск

Требования: Node.js 24+.

```bash
npm install
npm run dev
```

После запуска:

- web: `http://localhost:3000`;
- API: `http://localhost:4000`;
- health check: `http://localhost:4000/health`.

Экспорт документов доступен через `POST /v1/documents/export?format=docx|pdf`.

Основные проверки:

```bash
npm run typecheck
npm test
npm run build
```

## PostgreSQL и международные источники

Скопируйте `.env.example` в `.env`, затем запустите PostgreSQL и миграции.

```bash
docker compose up -d postgres
npm run db:migrate
npm run dev
```

Синхронизация global remote вакансий:

```bash
curl -X POST "http://localhost:4000/v1/sync/jobicy?text=Product%20Analyst&region=europe"
curl -X POST "http://localhost:4000/v1/sync/jobicy?text=Product%20Analyst&region=latam"
curl -X POST "http://localhost:4000/v1/sync/jobicy?text=Product%20Analyst&region=apac"
curl -X POST "http://localhost:4000/v1/sync/arbeitnow?text=Product%20Analyst"
curl -X POST "http://localhost:4000/v1/sync/greenhouse?board=stripe&company=Stripe&text=Product%20Analyst"
curl -X POST "http://localhost:4000/v1/sync/lever?site=spotify&company=Spotify&text=Product%20Analyst"
curl -X POST "http://localhost:4000/v1/sync/ashby?board=notion&company=Notion&text=Product%20Analyst"
```

Greenhouse, Lever и Ashby публикуют вакансии по доскам конкретных работодателей, а не через
единый глобальный каталог. Общий поиск автоматически проверяет встроенный набор
международных компаний. В настройках поиска можно добавить до 20 собственных
публичных досок по token/site или полному careers URL; каталог сохраняется локально
в браузере и участвует в каждом следующем поиске.

Единый поиск по пользовательскому профилю автоматически расширяет название
должности и опрашивает выбранные регионы:

```bash
curl -X POST "http://localhost:4000/v1/search" \
  -H "Content-Type: application/json" \
  -d '{"role":"Product Analyst","regions":["europe","latam","apac"],"aliases":["Growth Analyst"]}'
```

Тот же поиск запускается кнопкой «Найти вакансии» в интерфейсе. Профиль и
дополнительные названия должности сохраняются локально в браузере.

Match score учитывает сходство названия и тип роли. Совпавшие навыки повышают
уверенность, но не могут поднять выше порога вакансию другого типа — например,
`Data Engineer` для профиля `Product Analyst`.

Без Docker и `DATABASE_URL` API хранит найденные вакансии в памяти до
перезапуска процесса. Jobicy и Arbeitnow не требуют API-ключей; карточки всегда
ведут на оригинальную страницу источника. PostgreSQL нужен для постоянного
хранения и истории синхронизаций.
