# EMET Vegan Cafe — Deploy Guide

This repo is **one Vite/React app** (marketing site + customer tracking + staff
dashboard) plus **`backend/lambdas/`** (the order-tracking API). Amplify builds
and hosts the frontend; the Lambdas are deployed separately per the
[`EMET-order-tracking-build-v1.5.md`](./EMET-order-tracking-build-v1.5.md) guide.

> Do the **A2P 10DLC SMS registration first** — it takes days and is out of your
> control. In-app tracking works without it; texts switch on when it clears with
> no code change.

---

## 0. Prerequisites

- Node 18+ and Git (Windows / PowerShell).
- A GitHub repo.
- AWS account + AWS CLI configured (`aws configure`), one region everywhere (e.g. `us-east-1`).
- Stripe account (start in **test mode**).

---

## 1. Push to GitHub (PowerShell)

From the project root:

```powershell
npm install
npm run build          # sanity check: should output to .\dist

git init
git add .
git commit -m "EMET Vegan Cafe — marketing site + order tracking (v1)"
git branch -M main
git remote add origin https://github.com/<you>/emet-vegan-cafe.git
git push -u origin main
```

> `node_modules/`, `dist/`, and `.env*` are gitignored — never commit secrets.

---

## 2. Host the frontend on AWS Amplify

1. **Amplify Console → New app → Host web app → GitHub**, pick the repo/branch.
2. It auto-detects `amplify.yml` (build `npm run build`, output `dist`). **Save and deploy.**
3. **Rewrites and redirects** → add the SPA rule so `/checkout`, `/order/:id`, and
   `/staff` resolve on refresh/deep-link:
   - Source: `</^[^.]+$/>` · Target: `/index.html` · Type: **200 (Rewrite)**
4. **Environment variables** (App settings → Environment variables), then redeploy:
   - `VITE_API_BASE` = your API Gateway invoke URL, e.g. `https://abc123.execute-api.us-east-1.amazonaws.com/prod`
   - `VITE_STAFF_TOKEN` = the same shared staff code you set on the staff Lambdas
     *(this ships to the browser — it only gates the counter dashboard for v1; move to Cognito in v1.6)*
5. **Custom domain** → add `emet-vegan.shop` (root) and `www` → redirect to root.
   *(Domain not final yet — confirm before wiring DNS.)*

---

## 3. Backend (DynamoDB · Lambda · API Gateway · SNS)

Follow the full walkthrough in
[`EMET-order-tracking-build-v1.5.md`](./EMET-order-tracking-build-v1.5.md). Summary
of how this code maps to it:

### Tables
- `emet_orders` — PK `orderId`, **Streams ON (New and old images)**, GSI
  `status-createdAt-index` (PK `status`, SK `createdAt`).
- `emet_slots` — PK `slotId` (e.g. `2026-08-23T12:30`), attrs `capacity`,
  `booked`, `date`, `time`. Seed a couple days of rows to start.

### Routes → handlers (REST API, Lambda proxy, CORS locked to your origin)
| Method | Path | Handler |
|---|---|---|
| GET  | `/slots` | `getSlots.mjs` |
| POST | `/checkout-session` | `createCheckoutSession.mjs` |
| POST | `/stripe-webhook` | `stripeWebhook.mjs` |
| GET  | `/orders/{id}` | `getOrder.mjs` |
| GET  | `/orders` | `listOrders.mjs` (staff) |
| POST | `/orders/{id}/status` | `updateOrderStatus.mjs` (staff) |

Stream trigger (no route): `notifyOnStatus.mjs` on the `emet_orders` stream.

### Packaging a handler (PowerShell)
AWS SDK v3 is already in the Lambda runtime; only **`stripe`** must ship. For the
two handlers that import Stripe (`createCheckoutSession`, `stripeWebhook`):

```powershell
cd backend
npm install                      # installs stripe into backend/node_modules
# for each stripe-using handler, zip the handler + _lib.mjs + node_modules:
Compress-Archive -Path lambdas\createCheckoutSession.mjs, lambdas\_lib.mjs, node_modules -DestinationPath createCheckoutSession.zip -Force
Compress-Archive -Path lambdas\stripeWebhook.mjs, lambdas\_lib.mjs, node_modules -DestinationPath stripeWebhook.zip -Force
```

The other handlers (`getSlots`, `getOrder`, `listOrders`, `updateOrderStatus`,
`notifyOnStatus`) need no extra deps — zip the handler + `_lib.mjs`:

```powershell
Compress-Archive -Path lambdas\getSlots.mjs, lambdas\_lib.mjs -DestinationPath getSlots.zip -Force
# ...repeat per handler
```

> Cleaner alternative: put `stripe` in a **Lambda layer** and skip bundling it per
> function. Either works.

Set each function's **handler** to `<file>.handler` (e.g. `createCheckoutSession.handler`)
and **runtime** to Node 20.x.

### Environment variables (Lambda)
Set on the functions that need them:
- All: `ORDERS_TABLE=emet_orders`, `SLOTS_TABLE=emet_slots`, `ALLOWED_ORIGIN=https://emet-vegan.shop`
- `createCheckoutSession`, `stripeWebhook`: `STRIPE_SECRET_KEY`, `SITE_URL=https://emet-vegan.shop`
- `stripeWebhook`: `STRIPE_WEBHOOK_SECRET`
- `listOrders`, `updateOrderStatus`: `STAFF_TOKEN=<shared code>` (match `VITE_STAFF_TOKEN`)
- `notifyOnStatus`: `SITE_URL`

> Weekend-fine as env vars; move `STRIPE_*` and `STAFF_TOKEN` to **Secrets Manager**
> before real launch.

### IAM (least privilege)
- `getSlots`: `dynamodb:Scan` on `emet_slots`
- `createCheckoutSession`: `GetItem`/`UpdateItem` on `emet_slots`, `PutItem` on `emet_orders`
- `stripeWebhook`: `UpdateItem` on `emet_orders`
- `getOrder`: `GetItem` on `emet_orders`
- `listOrders`: `Query` on `emet_orders` + its GSI
- `updateOrderStatus`: `UpdateItem` on `emet_orders`
- `notifyOnStatus`: `sns:Publish` + DynamoDB Streams read on `emet_orders`

### Stripe webhook wiring
1. Deploy `stripeWebhook` behind `POST /stripe-webhook`.
2. Stripe → Developers → Webhooks → add the endpoint, subscribe to
   `checkout.session.completed`, copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Enable **email receipts** in Stripe settings.

> The signature is verified against the **raw** body; the handler decodes
> `isBase64Encoded` before verifying and never `JSON.parse`s first.

---

## 4. Launch checklist

- [ ] Test order in Stripe **test mode** (card `4242 4242 4242 4242`).
- [ ] Webhook (not the redirect) flips the order to `accepted`.
- [ ] Paid order appears on `/staff`; an abandoned checkout does **not**.
- [ ] Tap **Start making → Mark ready**; the `/order/:id` page advances on its 12s poll.
- [ ] A full slot is rejected server-side (**409**).
- [ ] SMS fires on `accepted` and `ready` (once 10DLC clears).
- [ ] Move Stripe keys + staff token to **Secrets Manager**; confirm CORS is locked to `https://emet-vegan.shop`.
- [ ] Swap to **live** Stripe keys + register the live webhook.

## Local dev
```powershell
npm run dev        # http://localhost:5173  (set VITE_API_BASE in a .env.local to hit a deployed API)
```

---

## Addendum — DoorDash storefront + Stripe catalog + domain

The `/` route is now a DoorDash-style storefront (minimal sticky header · sticky
category bar · category rail + food grid + live cart). Components live in
`src/components/` (`Header`, `CategoryNav`, `ProductGrid`, `ProductCard`,
`CartSidebar`, `ItemModal`) with shared cart state in `src/lib/cart.js`. The menu
hydrates from Stripe (see below) and falls back to `src/menu.js` if the catalog
endpoint isn't wired yet — so the site works immediately, images are placeholders
until Stripe supplies them.

### A. Add the catalog Lambda (`emet-listCatalog`)
- Handler file: `backend/lambdas/listCatalog.mjs` (imports Stripe → bundle it, same
  as `createCheckoutSession`): zip `listCatalog.mjs` + `_lib.mjs` + `node_modules`.
- Handler: `listCatalog.handler`, runtime Node 20.x.
- Env: `STRIPE_SECRET_KEY`, `ALLOWED_ORIGIN` (+ `ORDERS_TABLE`/`SLOTS_TABLE` are
  harmless if present). No DynamoDB IAM needed — it only calls Stripe.
- API Gateway: add **GET `/catalog`** → `emet-listCatalog` (Lambda proxy), enable
  CORS, redeploy the stage. `VITE_API_BASE` already points the frontend at it.

### B. Populate the Stripe catalog (so images + prices are live)
For each menu item in Stripe (**Products → Add product**):
- **Name**, **Description** (shows as the card description), and **upload an image**
  (this becomes `product.images[0]` on the card).
- Set a **default price** in USD (integer cents).
- **Tax code**: prepared food (`txcd_40030001`).
- **Metadata**: `category` (must match a storefront category, e.g. `Smoothies`),
  `vendor_id` = `emet`, optional `dietary` (comma-separated, e.g. `Plant-based, GF`),
  optional `menu_id` (stable id) and `sort` (number for ordering).

Once products exist, the storefront shows live catalog data with real images and no
code change. Until then it renders the local menu with placeholders.

> Later automation (optional): a `product.updated` webhook can cache the catalog in
> a table for faster loads — see `docs/ROADMAP.md` §2. The read path above is enough
> to go live.

### C. Point the domain to Amplify (Route 53 or DNS Provider)
Your custom domain is **`emetvegancafe.com`** (and `www.emetvegancafe.com`):

1. In **Amplify Console** → your app → **Hosting → Custom domains → Add domain** → enter `emetvegancafe.com`.
2. Map subdomains: `emetvegancafe.com` (root) → your branch, and `www` → redirect to root.
3. Configure the ACM SSL certificate records and CNAME/ALIAS records with your DNS registrar (Route 53, GoDaddy, Namecheap, Google Domains/Squarespace).

### D. AWS Lambda Environment Variables Update
Ensure the following are set on all deployed Lambdas in the AWS Lambda Console:
- `ALLOWED_ORIGIN` = `https://emetvegancafe.com`
- `SITE_URL` = `https://emetvegancafe.com`
- `STRIPE_SECRET_KEY` = `sk_live_...` (or `sk_test_...`)
- `STRIPE_WEBHOOK_SECRET` = `whsec_...`
- `ORDERS_TABLE` = `emet_orders`
- `SLOTS_TABLE` = `emet_slots`

### E. API Gateway CORS Check
If hitting API Gateway from `https://emetvegancafe.com`:
1. Open **API Gateway Console** → Select your API (`w5nf0u8on8` / `us-east-2`).
2. Ensure routes `/slots`, `/checkout-session`, `/catalog`, `/orders`, `/orders/{id}` have `OPTIONS` enabled (or Lambda proxy integration enabled).
3. If using Gateway-level CORS, add `https://emetvegancafe.com` and `https://www.emetvegancafe.com` to **Access-Control-Allow-Origin**.
4. Click **Deploy API** → Stage: `prod` (or your active stage).

### F. Add your hero video
The storefront's top hero plays a looping, muted background video.
- Put your file at **`public/hero.mp4`** (H.264/MP4, muted; ~5–15s loop, kept small
  — aim under ~5 MB for fast load). Optionally replace **`public/hero-poster.jpg`**
  with a still frame (shown before the video loads and on reduced-motion devices).
- No code change needed — it's referenced at `/hero.mp4`. To use a different name
  or a CDN URL, pass `videoSrc`/`poster` to `<Hero>` in `src/App.jsx`.
- The video is decorative (muted, `aria-hidden`) and auto-hides for visitors who
  prefer reduced motion, falling back to the poster.
