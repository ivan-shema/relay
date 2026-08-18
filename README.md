# Relay — Integrated Multimodal Transport Coordination Platform

Relay unifies buses, moto-taxis and shared rides from every city operator into one
app: passengers plan a trip, see live departures with real seats/fares/ETAs, book,
pay contactless, track the vehicle to their stop, and rate the ride.

Built from the Claude Design handoff (`Relay Platform.dc.html`) and the project spec
(`Description.docx`) on a real TypeScript / Prisma / Postgres backend with a Next.js
frontend. **All four roles are implemented** end-to-end against the database:

- **Passenger** — landing → auth → search → book → pay → track → rate, plus trips /
  wallet / profile.
- **Driver** — online toggle, incoming ride requests (accept / decline / complete),
  today's trips, earnings.
- **Operator console** — overview KPIs, live map, vehicles, routes, schedule, drivers
  (with manage + suspend), bookings, payments & payouts.
- **Admin console** — platform overview, users, operators, operator approvals
  (approve / reject), payments, reports, complaints, and a Generate-Report builder.

After login each role is routed to its own workspace (`/app`, `/driver`, `/operator`,
`/admin`); every console is guarded client-side and by role-checked API middleware.

**Onboarding is vetted, not self-selected.** Public registration only ever creates
Passenger accounts (no role picker). Drivers are onboarded exclusively by an Operator
inviting them (with ID + driving-licence KYC and document uploads). Operators go
through an **apply → admin-review → approve** flow: the applicant submits company
info, an ID/passport number, and their RDB business certificate; the account is
created as `PENDING` and the operator console stays locked (a review screen instead)
until an admin approves it in Admin → Approvals. Admin-created operator accounts skip
the queue (already `VERIFIED`) since the admin creating them is the trust signal.
KYC documents are PDF/JPEG/PNG/WebP only (no GIFs), stored server-side, and served
only via an authenticated, permission-checked `GET /documents/:id`.

## Tech stack

| Layer    | Choice |
|----------|--------|
| Monorepo | npm workspaces (`apps/*`, `packages/*`) |
| Backend  | Node + Express + TypeScript, Prisma ORM, PostgreSQL |
| Auth     | Custom JWT (access + refresh), bcrypt, OTP flows |
| Frontend | Next.js 14 (App Router), React 18, TypeScript |
| Shared   | `@relay/shared` — domain enums, DTOs, design tokens used by both apps |

## Repository layout

```
Relay/
├─ apps/
│  ├─ api/                 Express + Prisma backend
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma  full domain schema (users, operators, vehicles,
│  │  │  │                 routes, trips, bookings, payments, ratings, …)
│  │  │  └─ seed.ts        demo operators, drivers, places, routes, live trips
│  │  └─ src/
│  │     ├─ routes/        auth, places, trips, bookings, payments, tracking,
│  │     │                 ratings, planned
│  │     ├─ lib/           auth (jwt/bcrypt), mappers, tracking sim, http helpers
│  │     ├─ middleware/    requireAuth / requireRole
│  │     └─ server.ts
│  └─ web/                 Next.js frontend
│     └─ src/
│        ├─ app/           / (landing), /auth, /app (passenger)
│        ├─ components/    AppHeader
│        └─ lib/           api client, auth context
├─ packages/shared/        @relay/shared types + design tokens
├─ docker-compose.yml      Postgres 16
└─ package.json            workspace root
```

## Prerequisites

- Node.js ≥ 20 (tested on v22)
- A PostgreSQL 16 database. Easiest is the bundled `docker-compose.yml`
  (`docker compose up -d db`). No Docker? Point `DATABASE_URL` at any Postgres
  instance (local install, Neon, Supabase, RDS, …).

## Quick start

```bash
# 1. Install all workspaces
npm install

# 2. Configure env (defaults already match docker-compose)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# 3. Start Postgres (or set DATABASE_URL to your own)
docker compose up -d db

# 4. Create schema + seed demo data
npm run db:migrate --workspace @relay/api   # or: npm run prisma:push -w @relay/api
npm run db:seed

# 5. Run both apps (two terminals, or `npm run dev` for both)
npm run dev:api    # http://localhost:4000
npm run dev:web    # http://localhost:3000
```

Open http://localhost:3000.

### Demo logins (seeded, password `password123`)

| Role      | Identifier          |
|-----------|---------------------|
| Passenger | `amara@relay.app`   |
| Driver    | `jean@relay.app`    |
| Operator  | `ops@kigalibus.app` |
| Admin     | `admin@relay.app`   |

The landing page lets you **browse trips without an account**; signing in is only
required at booking. Register a new account to exercise the OTP verify flow.

## Mock integrations

Per the project plan, external providers are stubbed so everything runs offline with
no credentials (toggle in `apps/api/.env`):

- **OTP / SMS** (`MOCK_OTP=true`) — codes are logged to the API console; the code
  `000000` always passes (verify + password reset).
- **Payments** (`MOCK_PAYMENTS=true`) — Mobile Money / wallet / QR / smart card all
  succeed instantly. Wallet payments deduct the seeded balance. The real
  MTN/Airtel MoMo call belongs in `apps/api/src/routes/payments.ts`.
- **Deposits & withdrawals (Paypack)** — wallet top-ups (cashin) and operator
  payouts (cashout) go through [Paypack](https://paypack.rw), which handles both
  MTN MoMo and Airtel Money. Set `PAYPACK_CLIENT_ID` / `PAYPACK_CLIENT_SECRET`
  in `apps/api/.env` to go live; leave them empty and both flows settle
  instantly in mock mode. Real top-ups sit `PENDING` until the customer approves
  the USSD prompt — settled by the `POST /webhooks/paypack` webhook (configure
  the URL + `PAYPACK_WEBHOOK_SECRET` in the Paypack dashboard) or, in local dev,
  by the client's status poll against the Paypack events API.
- **Maps / GPS** — the live-tracking map uses the design's SVG with a simulated
  vehicle interpolated along the route polyline (`apps/api/src/lib/tracking.ts`),
  polled every 3s by the client. Swap in Google Maps + real GPS later.
- **Email** (`SMTP_HOST` empty) — every in-app notification is also sent to the
  user's email via `apps/api/src/lib/notify.ts`. Without SMTP credentials the
  emails are logged to the API console; set `SMTP_HOST/PORT/USER/PASS` +
  `MAIL_FROM` in `apps/api/.env` to send real mail. Notifications are pushed in
  real time over the `GET /me/stream` SSE channel, so the bell updates without
  a refresh.

## What the passenger slice does end-to-end

1. **Landing** (`/`) — pixel-faithful marketing page, browse without auth.
2. **Auth** (`/auth`) — login, register (Passenger/Driver/Operator), OTP verify,
   forgot/reset password. Real JWTs persisted in `localStorage`.
3. **Plan → Search** — origin/destination with live place suggestions from the API.
4. **Available trips** — real seeded departures with live seats, fares, surge, ETAs.
5. **Pay** — reserves the seat (decrements availability in a transaction), then a
   mock contactless payment confirms the booking.
6. **Track** — polls a simulated live position + ETA; board, then arrive.
7. **Done** — rate the trip (updates the driver's running average).
8. **Trips / Wallet / You** tabs — booking history, wallet, profile, sign out.

## API surface

```
GET    /health
POST   /auth/register | /auth/login | /auth/verify-otp
POST   /auth/forgot-password | /auth/reset-password | /auth/refresh
GET    /auth/me
GET    /places?q=
GET    /trips?origin=&destination=        GET /trips/:id
POST   /bookings   GET /bookings   GET /bookings/:id   POST /bookings/:id/cancel
POST   /payments   GET /payments
GET    /tracking/:bookingId
POST   /ratings
GET    /planned   POST /planned   DELETE /planned/:id
```

## Useful scripts

```bash
npm run typecheck                 # typecheck every workspace
npm run build                     # build shared → api → web
npm run db:seed                   # reseed demo data
npm run prisma:push -w @relay/api # push schema without a migration
```

## Verified

- `@relay/shared`, `@relay/api`, `@relay/web` all typecheck clean.
- `next build` produces an optimized production build (4 routes).
- API boots and serves `/health`; all DB-backed routes are wired and only need a
  running Postgres (start it, then `db:migrate` + `db:seed`).

## Wired to the backend

Beyond the core booking flow, these are backed by real endpoints + persistence
(not mock UI):

- **Passenger** — wallet balance + ledger with working **top-up**, real
  **notifications** (list + mark read), rider **stats**, and **saved places** CRUD.
- **Driver** — **cash-out** to MoMo (records a payout).
- **Operator** — **add vehicle**, **new route**, **add departure** (publishes a
  bookable trip), **invite driver** (creates the account), **withdraw** payout.
- **Admin** — **add user**, operator **approve/reject**, complaint **resolve**, and
  **CSV report export** (real download of platform transactions).

## Pagination

All list endpoints are bounded and the tabular ones are paginated with a standard
envelope — `{ items, total, page, pageSize, totalPages }` (parsed by
`apps/api/src/lib/pagination.ts`, typed as `Paginated<T>` in `@relay/shared`).
Paginated: passenger **bookings** & **notifications**; operator **vehicles /
schedule / drivers / bookings / transactions**; admin **users / operators /
transactions**. Pass `?page=&pageSize=` (default 8–10, max 100). The web tables use a
shared `usePaged` hook + `Pagination` (Prev / "page x of y" / Next) control; the rest
(dropdown lookups, "recent" widgets) are hard-capped.

## Roadmap (next)

- **Real integrations** — Google Maps + GPS, MTN/Airtel MoMo, SMS/email, websockets
  for push tracking/dispatch instead of polling.
- **Remaining cosmetic actions** — driver "navigate/call", operator export buttons,
  "Send money" — currently placeholders.

## Security note

The frontend pins `next@14.2.35` (latest patched 14.x). `npm audit` still lists
advisories whose fix lands only in Next 16 (a breaking major); they concern
self-hosted features this app doesn't use (image-optimizer remote patterns, i18n
middleware, etc.). Evaluate a Next 16 upgrade before production hardening.

---

The original design handoff lives in `handoff-extracted/` (gitignored) for reference.
