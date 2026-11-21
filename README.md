# FixMate Server — REST API

Express + TypeScript API for **FixMate**, a smart device and home appliance repair platform. It owns services, bookings, payments and the Pro Technician Plan, and verifies every request with a JWT stored in an HttpOnly cookie.

- **Live API:** https://fixmate-server-sage.vercel.app ([health check](https://fixmate-server-sage.vercel.app/api/health))
- **Live site:** https://fixmate-client-lac.vercel.app ([client repo](https://github.com/Istiak0614/fixmate-client))

## Test accounts

| Role | Email | Password |
|---|---|---|
| Admin | `admin@fixmate.com` | `Admin123` |
| Technician (Pro) | `rafi.tech@fixmate.demo` | `YOUR_DEMO_PASSWORD` |
| Customer | `nusrat@fixmate.demo` | `Demo123` |

The admin can only be created by the seed script (`npm run seed`); sign-up never accepts the admin role.

## Key features

- **Server-side search, filters (category, mode, price range), sorting and pagination** in one aggregation
- **JWT cookie auth** (`POST /api/jwt`, `POST /api/logout`) with `verifyToken`, `verifyCustomer`, `verifyTechnician`, `verifyAdmin`; the role is always read from the database
- **Status pipeline** with an allowed-transition table and a concurrency guard; payment only for completed jobs of the owner
- **Stripe Checkout** (amount from `booking.finalAmount` on the server) and a **signed webhook**; a unique index makes every payment save-once
- **Pro Technician Plan** subscription ($9.99/month) synced by webhook events; Free plan limited to 3 services
- **Reviews** for paid jobs (once per booking) with average ratings on services
- **Idempotent seed script** with BetterAuth-compatible accounts and demo data in every status

## Main endpoints

| Method & path | Access |
|---|---|
| `GET /api/services`, `/featured`, `/:id`, `/:id/reviews` | Public |
| `POST /api/services`, `GET /mine`, `PATCH /:id`, `PATCH /:id/availability`, `DELETE /:id` | Technician (owner) |
| `POST /api/bookings`, `GET /my`, `PATCH /:id/cancel`, `PATCH /:id/review` | Customer (owner) |
| `GET /api/bookings/technician`, `PATCH /:id/status` | Technician (owner) |
| `POST /api/payments/create-checkout-session`, `GET /verify`, `GET /my`, `GET /:id` | Customer |
| `POST /api/payments/webhook` | Stripe (signature checked) |
| `GET /api/subscriptions/me`, `POST /checkout`, `GET /verify`, `POST /cancel` | Technician |
| `GET /api/admin/stats`, `/users`, `/services`, `/bookings`, `/payments`; `PATCH /users/:id/role`, `/services/:id/approval` | Admin |
| `GET /api/users/me`, `PATCH /api/users/profile` | Signed in |

## npm packages

`express`, `mongodb`, `jsonwebtoken`, `cookie-parser`, `cors`, `dotenv`, `stripe` — dev: `typescript`, `tsx`, `@types/*`

## Run locally

```bash
git clone https://github.com/Istiak0614/fixmate-server.git
cd fixmate-server
npm install
cp .env.example .env   # then fill in the values
npm run seed           # optional: admin + demo data
npm run dev            # http://localhost:5000
stripe listen --forward-to localhost:5000/api/payments/webhook   # local webhook
```

### Environment variables (`.env`)

| Name | What it is |
|---|---|
| `PORT` | Local port (5000) |
| `MONGODB_URI`, `DB_NAME` | MongoDB Atlas connection |
| `JWT_SECRET` | Secret for the JWT cookie |
| `CLIENT_URL` | Client URL used for Stripe redirects |
| `CLIENT_URLS` | Comma-separated exact origins allowed by CORS (local + production) |
| `STRIPE_SECRET_KEY` | Stripe test secret key (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the webhook endpoint (`whsec_...`) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_DEMO_PASSWORD` | Only for `npm run seed` (local) |

Stripe webhook events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`.

The real `.env` is git-ignored; only `.env.example` is committed.
