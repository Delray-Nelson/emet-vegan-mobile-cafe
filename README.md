# EMET Vegan Cafe

Dark-themed (obsidian · gold · green) marketing site **and** order-tracking system
for EMET Vegan Cafe — one Vite/React app, deployed on AWS Amplify.

- `/` — menu + order-ahead modal
- `/checkout` — pickup-slot picker → Stripe Checkout
- `/order/:id` — customer tracker (3 stages, polls every 12s; Stripe `success_url`)
- `/staff` — owner counter dashboard (polls every 8s, behind a shared staff code)

Backed by Stripe → webhook → DynamoDB → owner dashboard → SNS SMS
(handlers in `backend/lambdas/`).

## Run locally
```bash
npm install
npm run dev        # http://localhost:5173
```
Set `VITE_API_BASE` (and `VITE_STAFF_TOKEN` for /staff) in `.env.local` to point at
a deployed API.

## Structure
```
src/            marketing site (App.jsx) + tracking screens (components/) + menu data
backend/lambdas backend handlers (Stripe, DynamoDB, SNS)
docs/           v1.5 build guide, DEPLOY.md, ROADMAP.md
```

## Deploy
See **[docs/DEPLOY.md](./docs/DEPLOY.md)** (PowerShell + GitHub + Amplify) and
**[docs/EMET-order-tracking-build-v1.5.md](./docs/EMET-order-tracking-build-v1.5.md)**
for the AWS/Stripe/SNS setup.

## Not built yet (see [docs/ROADMAP.md](./docs/ROADMAP.md))
- Delivery fees (by ZIP) — targeted next.
- Stripe product-catalog image/price sync — menu shape is already prepared for it.

© EMET Vegan Cafe LLC · *Bold Flavor. Rooted in Truth.*
