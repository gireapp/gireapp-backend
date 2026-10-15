# GIREAPP — Backend API

The API behind **GIREAPP** (Get It Right Edu App), a pan-African e-learning
platform for Secondary, Tertiary and Professional learners. The web client lives
in its own repository,
[`gireapp-frontend`](https://github.com/gireapp/gireapp-frontend).

Express · TypeScript · PostgreSQL (Neon) via Prisma · Zod · JWT sessions.

## Repository structure

An npm workspace with two packages:

- **`backend/`** — the Express API: routes, controllers, Prisma schema and
  migrations, email, object storage.
- **`shared/`** — `@gireapp/shared`: the types, Zod schemas and constants the API
  and the frontend both use. The backend consumes its compiled `dist/`, so
  **rebuild it after any change** (`npm run build --workspace=shared`).

> `@gireapp/shared` exists as **two hand-maintained copies** — this one and
> `./shared` in the frontend repo. A change to one must be made to the other, or
> the two sides silently disagree.

## API at a glance

| Prefix | Who | What |
| --- | --- | --- |
| `/api/auth` | Public / signed in | Register, email verification, guardian consent, login, logout, password reset, onboarding, and account changes (name, email, password, photo) |
| `/api/courses` | Learners | List courses for the learner's track, course detail, enrol, lessons, mark a lesson complete |
| `/api/quizzes` | Learners | Quiz intro, start (issues a signed start ticket), submit (graded on the server; pays out points and badges) |
| `/api/dashboard` | Learners | Everything the learner dashboard shows, in one call |
| `/api/support` | Signed in | Contact Support form |
| `/api/admin` | Staff only | Overview, analytics, student listing, course builder, quiz builder, upload URLs |
| `/api/health` | Anyone | Liveness check |

Every success response is `{ "success": true, "data": … }`; errors are
`{ "error": "…", "errors"?: { field: [messages] } }` with a 4xx/5xx status.

**Roles:** `/api/admin/*` requires `ADMIN` or `TUTOR`. Admins can manage
everything; a tutor only the courses and quizzes they wrote. Anything outside a
tutor's reach answers 404, not 403, so ids can't be probed.

## Getting started

Requires **Node.js 22.12 or later**. The backend compiles to CommonJS while
`@gireapp/shared` is an ES module, which needs `require(esm)` — unflagged only
from Node 22.12. Render runs 24.

```bash
npm install                              # both workspaces
npm run build --workspace=shared         # the backend imports the compiled package

cp backend/.env.example backend/.env     # then fill it in — see below
cd backend
npx prisma migrate deploy                # apply the migrations
ADMIN_SEED_PASSWORD='…' npm run db:seed  # optional: an admin and sample courses
cd ..

npm run dev                              # http://localhost:8000
```

**Use `.env`, not only `.env.local`.** The server reads both (`.env.local` wins),
but the Prisma CLI — migrations, seeding — reads only `.env`.

**Use migrations, not `db push`.** Production applies `prisma/migrations` with
`migrate deploy`; `db push` would let a local database drift from it. To change
the schema, edit `prisma/schema.prisma` and run `npm run db:migrate` in
`backend/`.

The seed creates `admin@gireapp.com` with the password you pass in
`ADMIN_SEED_PASSWORD` (at least 12 characters — it is never hard-coded), plus
three sample courses. It skips anything that already exists.

### Environment variables

Set in `backend/.env`. **Required** means the server or a core flow does not work
without it.

| Variable | Required | What it is |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Neon connection string (pooled). |
| `DIRECT_URL` | Yes | Neon direct connection, used by migrations. |
| `AUTH_SECRET` | Yes | Signs sessions. **Must be byte-for-byte identical to the frontend's.** The server refuses to start without it outside tests. |
| `CLIENT_IP_SECRET` | Yes, in production | **Must be identical to the frontend's.** The frontend's server forwards each learner's IP with it, so rate limits apply per learner; without it every learner shares one budget and a handful of sign-ins locks everyone out. Generate with `openssl rand -base64 32`. |
| `FRONTEND_URL` | Yes | **Exactly one** origin — the live site. It is the base for every link in an email (verification, password reset, guardian consent), so a comma-separated list is rejected at startup. |
| `CORS_ORIGINS` | No | Extra browser origins allowed by CORS, comma-separated. Defaults to `FRONTEND_URL` alone. |
| `NODE_ENV` | Yes, in production | Must be `production` there: it sets `Secure` on session cookies and keeps stack traces out of error responses. |
| `RESEND_API_KEY` | For email | Without it no verification, reset or notice email is sent. Check delivery with `npm run email:test -- you@example.com` in `backend/`. |
| `EMAIL_FROM` | For email | The sender. Its domain must be verified in Resend, or every send fails. |
| `SUPPORT_EMAIL` | Recommended | Where Contact Support messages go. |
| `S3_ENDPOINT` · `S3_REGION` · `S3_BUCKET` · `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY` | For uploads | Any S3-compatible storage (Cloudflare R2 in use). Without them, lesson PDFs and videos and profile photos cannot be uploaded; everything else works. The bucket stays private — uploads and reads both use short-lived signed URLs. |
| `S3_FORCE_PATH_STYLE` | No | Set to `false` only for AWS S3. |
| `PORT` | No | Defaults to `8000`. |
| `ADMIN_SEED_PASSWORD` | For seeding | Used only by `npm run db:seed`. |
| `SKIP_EMAIL_VERIFICATION` | **Never in production** | Development only: auto-verifies new accounts. |

## Commands

From the repository root:

```bash
npm run dev            # API with reload (tsx watch)
npm run build          # build shared, then the backend
npm start              # run the built API
```

From `backend/`:

```bash
npm test               # Vitest unit tests
npm run type-check     # tsc --noEmit
npm run db:migrate     # create and apply a migration (development)
npm run db:migrate:deploy   # apply pending migrations (what production runs)
npm run db:seed        # seed (needs ADMIN_SEED_PASSWORD)
npm run db:studio      # Prisma Studio
npm run email:test -- you@example.com   # check email delivery
```

## Deployment

Deployed on **Render** from the **`main`** branch, as defined in `render.yaml`.
Each deploy installs, builds, and runs `prisma migrate deploy` in the build step
(the free plan has no pre-deploy hook). Set the environment variables above in the
Render dashboard.

The free plan **sleeps when idle**: the first request after a quiet spell can
take close to a minute.

Branch flow: feature branches → `staging` → `main`. Only `main` is deployed.

## CI

`.github/workflows/ci.yml` runs on every push and pull request: a scan for
injected code, a dependency audit gate, then build, type-check and the unit tests.

## Security notes

- **The frontend never touches the database.** Every operation goes through this
  API.
- **Input is validated at the boundary** with the shared Zod schemas.
- **Quiz and course text is stored exactly as typed.** Prisma binds every value
  as a parameter, and the frontend renders text as text, so stored content cannot
  inject SQL or markup. (Escaping on the way in would corrupt it — "Ohm's law"
  would become `Ohm&#x27;s law`.)
- **Quizzes are graded on the server.** Correct answers never reach the browser
  before submission, and the time limit is enforced against the server's clock
  through a signed start ticket.
- **A password change or reset ends every existing session.**
