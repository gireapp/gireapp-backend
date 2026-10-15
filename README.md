# GIREAPP — Backend API

[![Backend CI](https://github.com/gireapp/gireapp-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/gireapp/gireapp-backend/actions/workflows/ci.yml)

The API behind **GIREAPP** (Get It Right Edu App), an e-learning platform for
African learners across three tracks — Secondary, Tertiary and Professional.
The web client lives in
[`gireapp-frontend`](https://github.com/gireapp/gireapp-frontend).

## Tech stack

- [Express](https://expressjs.com/) and TypeScript
- PostgreSQL via [Prisma](https://www.prisma.io/)
- Zod for request validation
- JWT sessions
- [Resend](https://resend.com/) for transactional email
- Any S3-compatible object storage for lesson files and profile photos
- Vitest for unit tests

## Repository structure

An npm workspace with two packages:

- **`backend/`** — the Express API: routes, controllers, Prisma schema and
  migrations, email and object storage.
- **`shared/`** — `@gireapp/shared`: the types, Zod schemas and constants used
  by both the API and the frontend. The backend consumes its compiled output,
  so rebuild it after any change.

## API overview

| Prefix | Access | Purpose |
| --- | --- | --- |
| `/api/auth` | Public / signed in | Registration, email verification, guardian consent, login, logout, password reset, onboarding and account changes |
| `/api/courses` | Learners | Courses for the learner's track, enrolment, lessons and progress |
| `/api/quizzes` | Learners | Quiz intro, start and submission, graded on the server |
| `/api/dashboard` | Learners | Everything the learner dashboard shows, in one call |
| `/api/support` | Signed in | Contact Support |
| `/api/admin` | Staff | Overview, analytics, students, course and quiz management, upload URLs |
| `/api/health` | Anyone | Health check |

Successful responses are wrapped as `{ "success": true, "data": … }`. Errors
are `{ "error": "…", "errors"?: { "field": ["message"] } }` with a 4xx or 5xx
status.

`/api/admin/*` requires the `ADMIN` or `TUTOR` role. Admins can manage all
content; tutors can manage only the courses and quizzes they created.

## Getting started

### Prerequisites

- **Node.js 22.12 or later** and npm. The backend compiles to CommonJS and
  loads the ES-module shared package through `require(esm)`, which is
  available without a flag from Node 22.12.
- A PostgreSQL database

### Installation

```bash
git clone https://github.com/gireapp/gireapp-backend.git
cd gireapp-backend
npm install
npm run build --workspace=shared
cp backend/.env.example backend/.env
```

Use `backend/.env` rather than only `.env.local`: the server reads both, but
the Prisma CLI reads only `.env`.

### Configuration

Set these in `backend/.env`:

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string. Use the pooled connection if your provider offers one. |
| `DIRECT_URL` | Yes | Direct (unpooled) connection, used by migrations. |
| `AUTH_SECRET` | Yes | Signs session tokens. Must be identical to the frontend's `AUTH_SECRET`. The server will not start without it. |
| `FRONTEND_URL` | Yes | The frontend's origin, used to build links in emails. Must be a single origin; the server refuses to start if it is a list. |
| `CORS_ORIGINS` | No | Additional browser origins allowed by CORS, comma-separated. Defaults to `FRONTEND_URL`. |
| `NODE_ENV` | In production | Set to `production` to mark session cookies `Secure` and keep stack traces out of error responses. |
| `CLIENT_IP_SECRET` | In production | Shared with the frontend, which forwards each visitor's IP with it so rate limits apply per visitor. Must be identical on both sides. |
| `RESEND_API_KEY` | For email | Resend API key. Without it no email is sent. |
| `EMAIL_FROM` | For email | Sender address, on a domain verified with Resend. |
| `SUPPORT_EMAIL` | Recommended | Where Contact Support messages are delivered. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | For uploads | Any S3-compatible storage. Without them, file uploads are unavailable and everything else works. |
| `S3_FORCE_PATH_STYLE` | No | Leave as `true`; set to `false` only for AWS S3. |
| `PORT` | No | Defaults to `8000`. |
| `ADMIN_SEED_PASSWORD` | For seeding | Password for the admin account the seed script creates. At least 12 characters. |
| `SKIP_EMAIL_VERIFICATION` | Never in production | Development only: verifies new accounts automatically. |

Generate secrets with `openssl rand -base64 32`.

### Database

```bash
cd backend
npx prisma migrate deploy                   # apply all migrations
ADMIN_SEED_PASSWORD='…' npm run db:seed     # optional: an admin account and sample courses
```

To change the schema, edit `prisma/schema.prisma` and run `npm run db:migrate`
to create a migration. Use migrations rather than `prisma db push`, so every
environment applies the same history.

### Running

From the repository root:

```bash
npm run dev
```

The API is served at [http://localhost:8000](http://localhost:8000).

## Scripts

From the repository root:

| Command | Description |
| --- | --- |
| `npm run dev` | Start the API with live reload |
| `npm run build` | Build the shared package, then the API |
| `npm start` | Run the built API |

From `backend/`:

| Command | Description |
| --- | --- |
| `npm test` | Run the unit tests |
| `npm run type-check` | Type-check with `tsc` |
| `npm run db:migrate` | Create and apply a migration (development) |
| `npm run db:migrate:deploy` | Apply pending migrations |
| `npm run db:seed` | Seed the database (needs `ADMIN_SEED_PASSWORD`) |
| `npm run db:studio` | Open Prisma Studio |
| `npm run email:test -- you@example.com` | Send a test email to check delivery |

## Contributing

1. Branch from `staging` and open your pull request against `staging`.
2. Make sure the type-check and tests pass. CI also scans for injected code and
   runs a dependency audit on every push and pull request.
3. **`@gireapp/shared` is kept in both repositories.** A change to the copy in
   `shared/` needs the same change in the frontend's copy, and a rebuild here
   (`npm run build --workspace=shared`).

## Security

- The frontend never touches the database; every operation goes through this
  API.
- All input is validated at the boundary with the shared Zod schemas, and every
  database value is bound as a parameter.
- Quizzes are graded on the server. Correct answers never reach the browser
  before submission, and time limits use the server's clock.
- Changing or resetting a password ends every existing session.
- Login, registration and other sensitive routes are rate-limited.

If you find a security issue, please **do not open a public issue**. Report it
privately through
[GitHub's private vulnerability reporting](https://github.com/gireapp/gireapp-backend/security/advisories/new),
and we will respond there.

## License

Copyright (c) 2026 GIREAPP. All rights reserved.

This is proprietary software. The source is visible, but no licence is
granted to use, copy, modify or distribute it without GIREAPP's written
permission. See [LICENSE](LICENSE).
