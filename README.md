# CardCade API (`streambet_api`)

NestJS backend that powers **CardCade** — a sports-card / TCG marketplace bolted onto a live-streamed betting and entertainment platform. The legacy "Streambet" naming still appears in repo paths, image names, and a handful of configs; the product is CardCade.

The API serves:

- A **marketplace**: shops, prizes (slabs / sealed / raw / other), cart, Stripe Checkout, offers / counter-offers, reviews, shipping, and seller payouts.
- A **live-betting layer**: streams, betting rounds, betting variables, real-time updates over WebSockets, daily spin / promo / referral mechanics.
- A **wallet system**: dual-currency (CadeCoins purchased via Stripe / Coinflow + Sweep/Gold tokens earned via promotions), with auto-reload and platform payouts.
- **Pro subscriptions**, creator tooling, follower / inbox / notifications, geo-fencing, and an admin surface for everything above.

---

## Tech stack

| Layer | Stack |
| --- | --- |
| Runtime | Node.js 18+, NestJS 11, TypeScript |
| HTTP / Realtime | Express adapter, `@nestjs/websockets` (Socket.IO), `@nestjs/swagger` |
| Data | PostgreSQL (TypeORM 11), Redis (cache + BullMQ queues) |
| Background jobs | BullMQ (`@nestjs/bullmq`), `@nestjs/schedule` cron |
| Auth | JWT access + refresh tokens, Passport, Google OAuth |
| Payments | Stripe (Checkout, Connect, Subscriptions), Coinflow (crypto on-ramp) |
| Email | Nodemailer over AWS SES (`@nestjs-modules/mailer`) |
| Storage | AWS S3 (`@aws-sdk/client-s3` + presigned URLs) |
| Streaming | AWS Kinesis Video Streams |
| Identity | Persona (KYC), Abstract API (geolocation / VPN check) |
| Observability | New Relic, structured logging |
| Workflows | n8n webhooks (outbound automation) |

---

## Repository layout

```
streambet_api/streambet_api/
├── src/
│   ├── admin/              # Admin endpoints (users, streams, prizes, orders, payouts)
│   ├── auth/               # Local + Google OAuth, JWT issuance, refresh tokens
│   ├── awsmethods/         # S3 / SES / Kinesis helpers
│   ├── bet-round-history/  # Persisted history of completed betting rounds
│   ├── betting/            # Place / cancel bets, betting variables, lock + settle
│   ├── cart/               # Shopping cart for marketplace items
│   ├── chat/               # Per-stream chat persistence
│   ├── coin-package/       # CadeCoin SKUs sold via Stripe / Coinflow
│   ├── common/             # Shared decorators, guards, interceptors, pipes
│   ├── concierge/          # White-glove / high-value buyer support
│   ├── creator/            # Creator application + creator-only features
│   ├── daily-spin/         # Daily reward wheel
│   ├── database/           # TypeORM data source, migrations, seeders
│   ├── emails/             # SES transport + transactional template senders
│   ├── follower/           # Follow / unfollow shops & creators
│   ├── geo-fencing/        # Region + VPN gating for restricted jurisdictions
│   ├── inbox/              # In-app message threads (DMs + system notifications)
│   ├── integrations/       # 3rd-party adapters (PSA card lookup, Coinflow, Persona…)
│   ├── live-feed-update/   # Push events to the live activity feed
│   ├── notification/       # Notification dispatch (inbox + email + websocket)
│   ├── payments/           # Stripe Checkout / Connect, payouts, webhooks
│   ├── platform-payout/    # Seller payout calculations & ledger
│   ├── prize/              # Marketplace items: configurations, offers, orders, shipping
│   ├── promo-code/         # Promo / discount codes
│   ├── queue/              # BullMQ queue + worker registration
│   ├── redis/              # Redis client + cache module
│   ├── referral/           # Referral codes & rewards
│   ├── reviews/            # Buyer / seller post-transaction reviews
│   ├── scheduled-tasks/    # Cron jobs (review reminders, payout sweeps, cleanup)
│   ├── stream/             # Stream CRUD + live state
│   ├── subscription/       # Pro subscription (Stripe recurring)
│   ├── users/              # User profile, shop profile, settings
│   ├── wallets/            # Dual-currency wallet, transactions, auto-reload
│   ├── webhook/            # Inbound webhooks (Stripe, Coinflow, Persona, n8n)
│   └── ws/                 # Socket.IO gateways (betting, chat, presence)
├── test/                   # E2E test harness
├── docker-compose.yml      # Local Postgres + Redis
├── Dockerfile              # Production image (used by ECS)
├── docker-entrypoint.sh    # Pulls SSM params at container start
├── typeorm.config.ts       # CLI data-source for migrations
└── package.json
```

---

## Getting started

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+ (the staging schema is a useful starting point — see "Database" below)
- Redis 6+
- Docker (optional, for local Postgres / Redis)
- AWS credentials with read access to the SSM Parameter Store paths and S3 bucket (only required for environments that use SSM at boot — local dev runs from `.env`)

### Installation

```bash
cd streambet_api/streambet_api
npm install
```

### Local environment

Create `.env` in `streambet_api/streambet_api/`. The repo's `.env` already contains a working **local + staging-DB** template you can copy from. The variables actually consumed by the app are:

```bash
# Server
NODE_ENV=development
PORT=3000
CLIENT_URL=http://localhost:8080            # Frontend origin. NO trailing slash.
APPLICATION_HOST=https://stag.cardcade.fun  # Used in some absolute-link emails

# Database (Postgres)
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=streambet_db_local
DB_SYNC=false                # Leave false. Use migrations.
DB_LOGGING=false

# Redis
REDIS_ENABLED=true
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_USERNAME=default
REDIS_PASSWORD=password
REDIS_DB=0
REDIS_KEY_PREFIX=STREAMBET_LOCAL
REDIS_TLS=false

# JWT
JWT_SECRET=<random>
JWT_EXPIRES_IN=1d
REFRESH_TOKEN_SECRET=<random, different from JWT_SECRET>
REFRESH_TOKEN_EXPIRES_IN=30d

# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback

# Stripe (use test keys locally)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_MONTHLY_PRICE_ID=price_...
STRIPE_PRO_YEARLY_PRICE_ID=price_...
STRIPE_SUBSCRIPTION_WEBHOOK_SECRET=whsec_...

# AWS S3 + SES
FILE_DRIVER=s3
ACCESS_KEY_ID=...
SECRET_ACCESS_KEY=...
AWS_DEFAULT_S3_BUCKET=streambets3prod
AWS_S3_REGION=us-east-1

AWS_SMTP_USER=...
AWS_SMTP_PASSWORD=...
AWS_SMTP_HOST=email-smtp.us-east-1.amazonaws.com
AWS_SMTP_PORT=465
MAIL_SECURE=true
MAIL_REQUIRE_TLS=true
AWS_SMTP_REGION=us-east-1
AWS_EMAIL_FROM=contact@cardcade.fun
MAIL_DEFAULT_NAME=CardCade
MAIL_DEFAULT_EMAIL=contact@cardcade.fun
HOSTED=false

# Coinflow (crypto on-ramp)
COINFLOW_API_URL=https://api.coinflow.cash
COINFLOW_API_KEY=...
COINFLOW_DEFAULT_TOKEN=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
COINFLOW_MERCHANT_ID=streambet
COINFLOW_BLOCKCHAIN=solana
COINFLOW_WEBHOOK_SECRET=...
COINFLOW_WEBHOOK_ENV=stag

# Geo-fencing
ABSTRACT_API_KEY=...
BLOCKED_REGION=Connecticut,Delaware,Louisiana,Michigan,Montana,Washington,West Virginia
GEOFENCE_FAIL_CLOSED=true
DENY_ON_NO_IP=false
BLOCK_VPN=false
TRUST_PROXY=true

# Persona (KYC)
PERSONA_API_URL=https://withpersona.com/api/v1
PERSONA_API_KEY=...

# n8n outbound webhooks
N8N_ENABLED=true
N8N_WEBHOOK_URL=https://n8n.example.com/webhook/...
N8N_WEBHOOK_SECRET=...
N8N_RETRIES=3
N8N_RETRY_DELAY_MS=1000
N8N_TIMEOUT_MS=5000

# PSA card lookup
PSA_ACCESS_TOKEN=...

# Tooling
IS_SWAGGER_ENABLED=true
IS_BULLMQ_UI_ENABLED=true
NEW_RELIC_ENABLED=false
NEW_RELIC_APP_NAME=Streambet
NEW_RELIC_LICENSE_KEY=...
```

> ⚠️ **`CLIENT_URL` must not have a trailing slash.** The app concatenates paths directly (`${CLIENT_URL}/transactions?leave=...`), and React Router does not normalise `//`. A trailing slash will produce `https://cardcade.fun//transactions` → 404 in the browser.

### Run

```bash
# Dev (watch mode)
npm run start:dev

# Debug
npm run start:debug

# Production build
npm run build && npm run start:prod
```

By default the API listens on `http://localhost:3000` with the global prefix `/api`.

### Docker (Postgres + Redis only)

```bash
docker-compose up -d   # Postgres on 5432, Redis on 6379
docker-compose down
```

The application itself is normally run with `npm run start:dev` against those containers; the included `Dockerfile` is the production image used by ECS.

---

## Database

### Migrations (the supported workflow)

```bash
# Create a new empty migration
npm run migration:create -- src/database/migrations/AddSomething

# Generate from entity diffs
npm run migration:generate -- src/database/migrations/AddSomething

# Apply
npm run migration:run

# Rollback the most recent
npm run migration:revert
```

`typeorm.config.ts` reads the same env vars as the app and is what the CLI uses.

### `DB_SYNC` (auto-schema)

`DB_SYNC=true` makes TypeORM diff entities against the live schema on boot and apply changes. Convenient for throwaway local DBs:

```bash
npm run db:sync          # dev with sync
npm run db:reset         # dev with sync + DB_DROP_SCHEMA=true (NUKES the database)
npm run db:sync:prod     # built artifact with sync
```

Do **not** enable `DB_SYNC` against shared (staging / prod) databases — migrations are the source of truth there.

See [src/database/README.md](./src/database/README.md) for more.

---

## API documentation (Swagger)

When `IS_SWAGGER_ENABLED=true`, interactive docs are served at:

```
http://localhost:3000/api/docs
```

Auth header (`Authorization: Bearer <accessToken>`) is configured via `@nestjs/swagger`'s bearer auth, so you can paste a token in the "Authorize" dialog and call protected endpoints directly.

---

## Modules at a glance

The route prefix on every endpoint is `/api`. All paths below omit it.

| Prefix | Module | What lives here |
| --- | --- | --- |
| `/auth` | `auth/` | Email/password + Google OAuth login, JWT issuance, refresh, logout, `me` |
| `/users` | `users/` | Profile, shop profile, settings, public lookups by username |
| `/wallets` | `wallets/` | Dual-currency balance, transaction history, auto-reload config |
| `/cart` | `cart/` | Add / update / remove marketplace items, multi-seller cart |
| `/prizes` | `prize/` | Public marketplace browse, item detail, offers, orders, reviews flow |
| `/seller/prizes` | `prize/` | Seller-side: my shop items CRUD, my orders, my offers, mark-shipped |
| `/seller/prizes/psa` | `integrations/psa/` | PSA cert lookup for seller listing flow |
| `/admin/prizes` | `prize/` | Admin-side prize / order / offer management |
| `/reviews` | `reviews/` | Submit and list buyer / seller reviews |
| `/inbox` | `inbox/` | DM threads, system messages, mark-read |
| `/admin/inbox` | `inbox/` | Admin broadcast + per-user message tools |
| `/payments` | `payments/` | Stripe Checkout sessions, Connect onboarding, payout queries |
| `/coin-package` | `coin-package/` | CadeCoin SKUs (purchasable bundles) |
| `/subscription` | `subscription/` | Pro subscription start / cancel / portal links |
| `/daily-spin` | `daily-spin/` | Spin status + claim |
| `/concierge` | `concierge/` | High-value buyer concierge requests |
| `/creator` | `creator/` | Creator application + creator-only data |
| `/stream` | `stream/` | Stream metadata, schedule, public detail |
| `/betting` | `betting/` | Place / cancel bets, get betting state for a stream |
| `/chat` | `chat/` | Persisted stream chat |
| `/notification` | `notification/` | Push notifications |
| `/emails` | `emails/` | (Internal) re-trigger transactional emails |
| `/assets` | `assets/` | Presigned S3 upload URLs |
| `/admin` | `admin/` | Cross-cutting admin (users, streams, betting, wallet adjustments) |
| `/webhook` | `webhook/` | Inbound webhooks (Stripe core + Connect, Coinflow, Persona, n8n) |

Use Swagger (`/api/docs`) for the canonical, always-current per-route reference — handler-level `@ApiOperation` / `@ApiResponse` decorators document the shapes.

---

## Authentication

JWT access + refresh tokens with full rotation.

### Tokens

| Token | Default TTL | Where it lives |
| --- | --- | --- |
| Access | `JWT_EXPIRES_IN` (1d) | Sent as `Authorization: Bearer <token>` |
| Refresh | `REFRESH_TOKEN_EXPIRES_IN` (30d) | Stored client-side; also persisted in DB for revocation |

The two token types use **separate secrets** (`JWT_SECRET` vs `REFRESH_TOKEN_SECRET`).

### Flow

1. `POST /api/auth/register` or `POST /api/auth/login` returns `{ accessToken, refreshToken, ...user }`.
2. Client sends `Authorization: Bearer <accessToken>` with every request.
3. On 401, client calls `POST /api/auth/refresh` with the refresh token; the server issues a new pair and invalidates the old refresh row.
4. `POST /api/auth/logout` deletes the refresh row server-side.

The refresh endpoint is guarded by `RefreshTokenGuard`, which:

1. Pulls the refresh token from the request body
2. Verifies the JWT signature + expiry
3. Looks up the row by user + token in Postgres (rejects if missing → reuse / revoked)
4. Loads the user (rejects if disabled / deleted)
5. Attaches `request.user` for the controller

### Google OAuth

`GET /api/auth/google` → `GET /api/auth/google/callback` → redirect to:

```
${CLIENT_URL}/auth/google-callback?token=<accessToken>&refreshToken=<refreshToken>
```

### Example

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier": "user@example.com", "password": "password123"}'

# Authenticated request
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer eyJhbGciOi..."

# Refresh
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "eyJhbGciOi..."}'
```

---

## Payments

### Stripe

Three webhook secrets are configured because three different Stripe surfaces post to us:

| Secret | Webhook source | Endpoint |
| --- | --- | --- |
| `STRIPE_WEBHOOK_SECRET` | Core account (Checkout, payment intents) | `POST /api/webhook/stripe` |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Connect platform (seller onboarding, transfers) | `POST /api/webhook/stripe-connect` |
| `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | Pro recurring subscription events | `POST /api/webhook/stripe-subscription` |

Buy-flow `success_url` and `cancel_url` are built from `CLIENT_URL`; remember the no-trailing-slash rule.

### Coinflow

Card / crypto on-ramp for purchasing CadeCoins. Inbound webhook lands at `POST /api/webhook/coinflow`, validated against `COINFLOW_WEBHOOK_SECRET`. Set `COINFLOW_WEBHOOK_ENV=stag` or `prod` to match the dashboard env.

### Wallets

Dual currency:

- **CadeCoins** — purchased with real money (Stripe / Coinflow). `50 coins = $1 USD` (used for marketplace pricing display).
- **Sweep / Gold tokens** — earned via daily spin, promo codes, referrals; used for live betting under per-round limits exposed by `/auth/me` (`maxSweepCoinsBet`, `maxGoldCoinsBet`, `maxCadeCoinsBet`).

Auto-reload (`POST /api/payments/auto-reload`) charges the user's saved Stripe payment method when balance dips below a threshold.

---

## WebSockets

Gateways live in `src/ws/`. Clients connect to the same port as HTTP (`/socket.io/`) and authenticate by passing the JWT in the connection `auth` payload.

### Client → server

| Event | Purpose |
| --- | --- |
| `joinStream` | Join a stream room (chat + betting updates) |
| `leaveStream` | Leave a stream room |
| `placeBet` | Place a bet without an HTTP round-trip |
| `sendChatMessage` | Send a chat message in the stream room |

### Server → client

| Event | Purpose |
| --- | --- |
| `joinedStream` | Ack of a successful join |
| `bettingUpdate` | Pool sizes, leaderboards, odds updates |
| `bettingLocked` | Round is locked; no new bets |
| `winnerDeclared` | Round resolved; payouts dispatched |
| `chatMessage` | New chat message in the room |
| `notification` | Per-user push (offer received, order shipped, payout sent…) |
| `liveFeedUpdate` | Global activity feed entries (sales, big wins) |

The marketplace also dispatches notification events to the user's personal room (`user:<id>`) for inbox / order / offer activity.

---

## Background jobs

BullMQ powers async work; queues are registered in `src/queue/` and consumed by the workers in each owning module.

Notable queues:

- **email** — transactional sends via SES (review reminders, order updates, payout notifications).
- **payouts** — schedules and ledgers seller payouts.
- **n8n** — outbound webhook dispatch (with retry/backoff using `N8N_RETRIES` + `N8N_RETRY_DELAY_MS`).
- **scheduled-tasks** — cron-driven (`@nestjs/schedule`) jobs in `src/scheduled-tasks/` (e.g. review reminders 48h after delivery).

When `IS_BULLMQ_UI_ENABLED=true`, the Bull Board dashboard is mounted at `/api/admin/queues` (admin-guarded).

---

## Geo-fencing

`geo-fencing/` resolves the request IP via Abstract API and blocks any region listed in `BLOCKED_REGION`. Behaviour knobs:

| Var | Effect |
| --- | --- |
| `GEOFENCE_FAIL_CLOSED=true` | If lookup fails → block (recommended). |
| `DENY_ON_NO_IP=true` | Block requests with no resolvable IP. |
| `BLOCK_VPN=true` | Block requests detected as VPN / proxy. |
| `TRUST_PROXY=true` | Honour `X-Forwarded-For` (required behind ALB / CloudFront). |

---

## Deployment

Production is deployed to **AWS ECS Fargate** behind an ALB. The container fetches its env from **AWS Systems Manager Parameter Store** at boot via `docker-entrypoint.sh`.

### Parameter Store layout

```
/cardcade/non_pro_dev/<KEY>      # dev
/cardcade/non_pro_stag/<KEY>     # staging
/cardcade/non_pro_prod/<KEY>     # production
```

…where `<KEY>` matches the env var name (e.g. `CLIENT_URL`, `STRIPE_SECRET_KEY`). Updating a parameter requires restarting the ECS task for the new value to take effect.

> 🪤 **Watch out:** if `/cardcade/non_pro_prod/CLIENT_URL` ends in a `/`, every transactional URL will be `https://cardcade.fun//path` and React Router will 404 it.

### Image registry

- ECR repo: `streambet-backend` (legacy name, keep as-is).
- One ECS cluster per env: `streambet-dev`, `streambet-stag`, `streambet-prod`.
- One task definition per env: `streambet-backend-dev` etc.
- Container port: `3000`.
- IAM:
  - **Execution role** — pull from ECR, write CloudWatch logs.
  - **Task role** — read SSM parameters under the env's prefix, R/W to the S3 bucket, send via SES.

### Pipeline

CI/CD lives in `.gitlab-ci.yml` (legacy) and / or GitHub Actions in `.github/workflows/`. Stages:

1. **Validate** — `npm run lint`
2. **Test** — `npm test` against ephemeral Postgres + Redis
3. **Build** — `docker build` → push to ECR with the commit SHA tag
4. **Deploy** — render task definition → `aws ecs update-service` (force-new-deployment)

Branch → environment mapping:

- `dev` → dev
- `staging` / `stag` → staging
- `prod` / `main` → production (manual gate)

### Required CI variables

| Var | Purpose |
| --- | --- |
| `AWS_ACCESS_KEY_ID` | Deploy user with ECR push + ECS update perms |
| `AWS_SECRET_ACCESS_KEY` | ↑ |
| `AWS_ACCOUNT_ID` | Used to construct the ECR registry URL |
| `AWS_DEFAULT_REGION` | Usually `us-east-1` |

---

## Testing & quality

```bash
npm test               # unit
npm run test:watch     # unit, watch
npm run test:cov       # unit + coverage
npm run test:e2e       # E2E (requires Postgres + Redis)
npm run lint           # ESLint --fix
npm run format         # Prettier write
```

Husky runs lint on commit. See [TYPESCRIPT-SAFETY.md](./TYPESCRIPT-SAFETY.md) for the project's TS conventions.

---

## Useful scripts (cheat sheet)

```bash
npm run start:dev               # dev w/ watch
npm run start:debug             # dev + node --inspect
npm run build                   # nest build → dist/
npm run start:prod              # node dist/src/main

npm run migration:create -- src/database/migrations/<Name>
npm run migration:generate -- src/database/migrations/<Name>
npm run migration:run
npm run migration:revert

npm run db:sync                 # dev w/ TypeORM sync (local only)
npm run db:reset                # dev w/ sync + drop schema (DESTRUCTIVE)

npm test
npm run test:e2e
npm run lint
```

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Email links return 404 in browser (e.g. `https://cardcade.fun//transactions`) | `CLIENT_URL` SSM param has a trailing slash. Fix the param, restart the ECS task. Already-sent emails are baked-in and stay broken. |
| Stripe Checkout success page 404s | Same — `success_url` is built from `CLIENT_URL`. Existing checkout sessions retain the old URL until they expire. |
| `EAUTH` from SES on send | `AWS_SMTP_USER` / `AWS_SMTP_PASSWORD` are SMTP creds (generated from an IAM user), not raw IAM access keys. |
| `RefreshTokenGuard` rejects a valid-looking refresh token | The token row was rotated by another login or `logout`. The client must re-authenticate. |
| Webhooks 400 with `Webhook signature verification failed` | Wrong secret for the surface (core vs Connect vs Subscription). Each Stripe webhook has its own `whsec_`. |
| Local Stripe webhooks never fire | Run `stripe listen --forward-to localhost:3000/api/webhook/stripe` and use the `whsec_` it prints. |
| `redis: NOAUTH Authentication required` | `REDIS_USERNAME` / `REDIS_PASSWORD` mismatch with the cluster, or ACL not granted. |

---

## Related

- Frontend: [`streambet_web`](../../streambet_web) — React + Vite + Tailwind app at `cardcade.fun`.
- Database guide: [src/database/README.md](./src/database/README.md)
- TS conventions: [TYPESCRIPT-SAFETY.md](./TYPESCRIPT-SAFETY.md)
