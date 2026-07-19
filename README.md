# Find Job

Персональный сервис поиска работы: собирает вакансии из разных источников,
объединяет дубликаты, оценивает соответствие профилю кандидата и помогает
подготовить резюме и сопроводительное письмо для конкретной вакансии.

## Состояние проекта

Реализован первый вертикальный срез MVP:

- веб-дашборд с адаптивным интерфейсом;
- единая модель вакансии;
- поиск, формат работы и порог соответствия;
- объяснимый match score;
- локальное сохранение вакансий в рамках сессии;
- Node.js API с `/health` и `/v1/jobs`;
- тесты доменной фильтрации.

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

Основные проверки:

```bash
npm run typecheck
npm test
npm run build
```

## PostgreSQL и HeadHunter

Скопируйте `.env.example` в `.env` и укажите контактный `HH_USER_AGENT`.
Для стабильной синхронизации HeadHunter рекомендуется также
`HH_ACCESS_TOKEN` зарегистрированного приложения.

```bash
docker compose up -d postgres
npm run db:migrate
npm run dev
```

Запуск синхронизации:

```bash
curl -X POST "http://localhost:4000/v1/sync/hh?text=Product%20Analyst&area=113"
```

Без Docker и `DATABASE_URL` API продолжает работать на демо-данных. Анонимный
HH API может вернуть требование CAPTCHA; такой ответ отображается как
`hh_captcha_required`, а не как пустой результат.
