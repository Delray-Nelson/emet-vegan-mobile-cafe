# EMET Vegan Cafe — Master Build & Launch Guide (A–Z)

The single, ordered guide to take **emet-vegan.shop** from the code in
`emet-vegan-cafe.zip` to a live web app. This supersedes the earlier runbook — it
reflects the full scope we built: a DoorDash-style storefront with a video hero, a
Stripe-catalog-driven menu, Stripe checkout, and the order-tracking system
(webhook → DynamoDB → staff dashboard → SMS).

- **You run everything here.** No code changes required — it's config, console
  clicks, and copy-paste commands (Windows / PowerShell).
- **Time:** ~5–7 focused hours of setup, plus two background clocks that don't
  block you (SMS registration = days; DNS propagation = minutes–hours).

> **Legend** — ✅ success check (verify before moving on) · 🔑 produces a value you
> reuse later (keep a scratch note) · ⏳ slow/background.

---

## What you're deploying (architecture at a glance)

**Frontend** (one React/Vite app, hosted on Amplify) with four routes:

| Route | Who | What |
|---|---|---|
| `/` | customer | Video hero + DoorDash-style storefront (menu, cart) |
| `/checkout` | customer | Pickup-slot picker → Stripe Checkout |
| `/order/:id` | customer | Order tracker (3 stages, polls 12s) — Stripe `success_url` |
| `/staff` | owner | Counter dashboard (polls 8s, staff-code gated) |

**Backend** (8 Lambdas behind API Gateway):

| Method · Path | Handler | Notes |
|---|---|---|
| GET · `/catalog` | `listCatalog` | Menu from Stripe product catalog |
| GET · `/slots` | `getSlots` | Pickup windows |
| POST · `/checkout-session` | `createCheckoutSession` | Server-side price + slot reserve → Stripe |
| POST · `/stripe-webhook` | `stripeWebhook` | Paid → order becomes `accepted` |
| GET · `/orders/{id}` | `getOrder` | Tracker data |
| GET · `/orders` | `listOrders` | Staff — active paid orders |
| POST · `/orders/{id}/status` | `updateOrderStatus` | Staff — advance order |
| *(DynamoDB stream)* | `notifyOnStatus` | SMS on `accepted` + `ready` |

**Data:** DynamoDB `emet_orders` (+ stream + GSI) and `emet_slots`.
**External:** Stripe (payments + product catalog), AWS SNS (SMS), Route 53 (DNS).

**Status flow:** `pending_payment` → *(Stripe webhook)* → `accepted` → *Start
making* → `being_made` → *Mark ready* → `ready` → *Mark picked up* → `picked_up`.
Texts fire on `accepted` and `ready` only.

---

# PHASE 0 — Start the two background clocks (15 min, then wait)

### 0.1 ⏳ SMS registration (A2P 10DLC)
US app-to-person texting needs carrier registration that takes **days**. Everything
works without it — the in-app tracker is fully functional; texts just switch on when
it clears, no code change.
- AWS Console → **End User Messaging / SNS → SMS** → begin **10DLC** registration
  (brand + campaign), or use a **toll-free number** with verification (simpler).

### 0.2 ⏳ Domain
You own `emet-vegan.shop` but haven't pointed it. You'll connect it in **Phase 12**.
Until then the app runs on the Amplify URL. If the domain isn't already in Route 53,
you can either transfer DNS to Route 53 or keep it at your registrar (both covered
in Phase 12).

✅ 10DLC submitted. Continue — don't wait for approval.

---

# PHASE 1 — Get the code, add your video, run locally (25 min)

1. Unzip `emet-vegan-cafe.zip`. Open PowerShell in the folder:
   ```powershell
   cd .\emet-vegan-cafe
   ```
2. **Add your hero video:** put your file at **`public\hero.mp4`** (muted H.264/MP4,
   short loop, ideally < 5 MB). Optionally replace `public\hero-poster.jpg` with a
   still frame. (Skip and it uses the branded poster fallback.)
3. Install + run:
   ```powershell
   npm install
   npm run dev
   ```
   Open **http://localhost:5173**.

✅ You see the video hero, the storefront menu (with "Photo coming soon"
placeholders), the live cart, and the category bar. `/checkout`, `/order/:id`, and
`/staff` load but can't transact yet — they need the backend (Phases 5–10). Expected.

Stop with **Ctrl+C**.

---

# PHASE 2 — Push to GitHub (10 min)

```powershell
npm run build            # sanity check → creates .\dist with no errors

git init
git add .
git commit -m "EMET Vegan Cafe — storefront + tracking (v1)"
git branch -M main
git remote add origin https://github.com/<you>/emet-vegan-cafe.git
git push -u origin main
```
✅ Code on GitHub. `node_modules/`, `dist/`, `.env*` are gitignored — never commit
secrets. (Your `public\hero.mp4` **does** get committed — that's fine, or host it on
a CDN and point `<Hero videoSrc>` at it if it's large.)

---

# PHASE 3 — Host the frontend on Amplify (20 min)

1. **Amplify Console → Create new app → Host web app → GitHub** → pick the repo +
   `main`.
2. It auto-detects `amplify.yml` (build `npm run build`, output `dist`). **Save and
   deploy.** 🔑 note your Amplify URL (e.g. `https://main.xxxx.amplifyapp.com`).
3. **App settings → Rewrites and redirects → Add rule** (so deep links resolve):
   - Source `</^[^.]+$/>` · Target `/index.html` · Type **200 (Rewrite)**
4. Env vars come in **Phase 10** (we need the API URL first).

✅ Amplify URL loads the storefront. Use this URL as **SITE_URL / ALLOWED_ORIGIN**
everywhere below until the real domain is live (Phase 12).

---

# PHASE 4 — Stripe: keys + product catalog (45 min)

Work in **Test mode** first (toggle top-right in Stripe).

### 4.1 Keys
- **Developers → API keys** → copy **Secret key** (`sk_test_…`). 🔑 *STRIPE_SECRET_KEY*
- **Settings → Emails** → enable payment receipts (Stripe emails them automatically).

### 4.2 Build the product catalog (this is your live menu + images)
For **each** menu item: **Products → Add product**, then set:
- **Name**, **Description** (shows on the card), and **upload an image**
  (becomes the card photo, replacing the placeholder).
- A **default price** in USD.
- **Tax code:** prepared food (`txcd_40030001`).
- **Metadata** (critical — this is how the storefront groups + prices items):

  | Key | Value | Why |
  |---|---|---|
  | `category` | one of exactly: `Smoothies`, `Juices`, `Wraps & Handhelds`, `Nourish Bowls` | groups it into the right section (must match exactly) |
  | `vendor_id` | `emet` | single-vendor filter |
  | `menu_id` | the item's slug, e.g. `emet-garden-wrap` | **must match the server price key — see the box below** |
  | `dietary` | e.g. `Plant-based, GF` | optional badges (comma-separated) |
  | `sort` | a number | optional ordering within a category |

> **⚠️ Make `menu_id` match the server's price keys.** Server-side pricing in
> `backend/lambdas/_lib.mjs` (`PRICES_CENTS`) is keyed by these slugs:
> `sunrise-tropic-boost`, `royal-berry-recharge`, `green-elevation-boost`,
> `emet-georgia-gold`, `liquid-sunshine`, `tropical-sunrise`, `emet-garden-wrap`,
> `emet-rolls`, `emet-street-tacos`, `vegan-stir-fry-steak-bowl`,
> `creamy-emet-alfredo-bowl`. Set each product's `menu_id` to the matching slug so
> checkout can price it. New items not in that list: add them to both Stripe **and**
> `PRICES_CENTS` (+ `NAMES`), or migrate pricing to Stripe price ids (roadmap).
> Until the catalog is populated, the site uses the local menu with these same slugs,
> so checkout works out of the box.

✅ Products exist with images, prices, and metadata. (The `/catalog` endpoint that
serves them is wired in Phases 6–7; the storefront falls back to the local menu
until then, so nothing's blocked.)

---

# PHASE 5 — DynamoDB tables + seed slots (25 min)

Use your region consistently (guide assumes `us-east-1`).

**Orders table** (stream + dashboard index):
```powershell
aws dynamodb create-table --table-name emet_orders `
  --attribute-definitions AttributeName=orderId,AttributeType=S AttributeName=status,AttributeType=S AttributeName=createdAt,AttributeType=S `
  --key-schema AttributeName=orderId,KeyType=HASH `
  --billing-mode PAY_PER_REQUEST `
  --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES `
  --global-secondary-indexes '[{\"IndexName\":\"status-createdAt-index\",\"KeySchema\":[{\"AttributeName\":\"status\",\"KeyType\":\"HASH\"},{\"AttributeName\":\"createdAt\",\"KeyType\":\"RANGE\"}],\"Projection\":{\"ProjectionType\":\"ALL\"}}]' `
  --region us-east-1
```
**Slots table:**
```powershell
aws dynamodb create-table --table-name emet_slots `
  --attribute-definitions AttributeName=slotId,AttributeType=S `
  --key-schema AttributeName=slotId,KeyType=HASH `
  --billing-mode PAY_PER_REQUEST --region us-east-1
```
✅ Both **Active**. Open `emet_orders` → **Exports and streams** → 🔑 copy the
**Stream ARN** (used in Phase 9).

**Seed a few pickup slots** (`slotId` = `YYYY-MM-DDTHH:MM`, `booked` starts at 0):
```powershell
aws dynamodb put-item --table-name emet_slots --region us-east-1 --item '{\"slotId\":{\"S\":\"2026-08-24T11:30\"},\"date\":{\"S\":\"2026-08-24\"},\"time\":{\"S\":\"11:30 AM\"},\"capacity\":{\"N\":\"5\"},\"booked\":{\"N\":\"0\"}}'
aws dynamodb put-item --table-name emet_slots --region us-east-1 --item '{\"slotId\":{\"S\":\"2026-08-24T12:00\"},\"date\":{\"S\":\"2026-08-24\"},\"time\":{\"S\":\"12:00 PM\"},\"capacity\":{\"N\":\"5\"},\"booked\":{\"N\":\"0\"}}'
```
✅ `aws dynamodb scan --table-name emet_slots --region us-east-1` lists them.

---

# PHASE 6 — Create the 8 Lambdas (75–90 min)

Handlers live in `backend/lambdas/`. **Three** import Stripe and must ship with it
(`createCheckoutSession`, `stripeWebhook`, `listCatalog`); the rest need no deps (AWS
SDK v3 is in the Node 20 runtime). **Every** handler imports `_lib.mjs`, so include
it in every zip.

### 6.1 Build the zips (PowerShell, from project root)
```powershell
cd .\backend
npm install    # installs stripe into backend\node_modules

# Stripe-using handlers: handler + _lib.mjs + node_modules
Compress-Archive -Path lambdas\createCheckoutSession.mjs, lambdas\_lib.mjs, node_modules -DestinationPath createCheckoutSession.zip -Force
Compress-Archive -Path lambdas\stripeWebhook.mjs,          lambdas\_lib.mjs, node_modules -DestinationPath stripeWebhook.zip          -Force
Compress-Archive -Path lambdas\listCatalog.mjs,            lambdas\_lib.mjs, node_modules -DestinationPath listCatalog.zip            -Force

# No-dep handlers: handler + _lib.mjs
Compress-Archive -Path lambdas\getSlots.mjs,          lambdas\_lib.mjs -DestinationPath getSlots.zip          -Force
Compress-Archive -Path lambdas\getOrder.mjs,          lambdas\_lib.mjs -DestinationPath getOrder.zip          -Force
Compress-Archive -Path lambdas\listOrders.mjs,        lambdas\_lib.mjs -DestinationPath listOrders.zip        -Force
Compress-Archive -Path lambdas\updateOrderStatus.mjs, lambdas\_lib.mjs -DestinationPath updateOrderStatus.zip -Force
Compress-Archive -Path lambdas\notifyOnStatus.mjs,    lambdas\_lib.mjs -DestinationPath notifyOnStatus.zip    -Force
```
✅ Eight `.zip` files in `backend\`.

### 6.2 Create each function
Lambda → **Create function → Author from scratch**, Runtime **Node.js 20.x**, upload
the zip, set **Handler = `<file>.handler`**:

| Function | Zip | Handler |
|---|---|---|
| `emet-listCatalog` | listCatalog.zip | `listCatalog.handler` |
| `emet-getSlots` | getSlots.zip | `getSlots.handler` |
| `emet-createCheckoutSession` | createCheckoutSession.zip | `createCheckoutSession.handler` |
| `emet-stripeWebhook` | stripeWebhook.zip | `stripeWebhook.handler` |
| `emet-getOrder` | getOrder.zip | `getOrder.handler` |
| `emet-listOrders` | listOrders.zip | `listOrders.handler` |
| `emet-updateOrderStatus` | updateOrderStatus.zip | `updateOrderStatus.handler` |
| `emet-notifyOnStatus` | notifyOnStatus.zip | `notifyOnStatus.handler` |

### 6.3 Environment variables (set only what each needs)
Invent one long random **STAFF_TOKEN** (reused in Amplify). Use your Amplify URL for
`SITE_URL`/`ALLOWED_ORIGIN` for now.

| Variable | Functions | Value |
|---|---|---|
| `ORDERS_TABLE` | all order/tracking + createCheckout | `emet_orders` |
| `SLOTS_TABLE` | getSlots, createCheckoutSession | `emet_slots` |
| `ALLOWED_ORIGIN` | all HTTP handlers (incl. listCatalog) | your origin (Amplify URL now → `https://emet-vegan.shop` later) |
| `STRIPE_SECRET_KEY` | createCheckoutSession, stripeWebhook, listCatalog | `sk_test_…` |
| `SITE_URL` | createCheckoutSession, stripeWebhook, notifyOnStatus | your site URL |
| `STRIPE_WEBHOOK_SECRET` | stripeWebhook | *(Phase 8)* |
| `STAFF_TOKEN` | listOrders, updateOrderStatus | 🔑 shared staff code |

### 6.4 IAM (least privilege — Configuration → Permissions → role)
- `emet-listCatalog`: none beyond default logging (only calls Stripe)
- `emet-getSlots`: `dynamodb:Scan` on `emet_slots`
- `emet-createCheckoutSession`: `GetItem`+`UpdateItem` on `emet_slots`, `PutItem` on `emet_orders`
- `emet-stripeWebhook`: `UpdateItem` on `emet_orders`
- `emet-getOrder`: `GetItem` on `emet_orders`
- `emet-listOrders`: `Query` on `emet_orders` + `emet_orders/index/*`
- `emet-updateOrderStatus`: `UpdateItem` on `emet_orders`
- `emet-notifyOnStatus`: `sns:Publish` + attach **`AWSLambdaDynamoDBExecutionRole`** (stream read)

✅ Eight functions, each with correct handler, env, role.

---

# PHASE 7 — API Gateway (30 min)

Create a **REST API** (`emet-api`). Add resources/methods with **Lambda proxy
integration** ("Use Lambda Proxy integration" checked):

| Method | Resource | Function |
|---|---|---|
| GET | `/catalog` | emet-listCatalog |
| GET | `/slots` | emet-getSlots |
| POST | `/checkout-session` | emet-createCheckoutSession |
| POST | `/stripe-webhook` | emet-stripeWebhook |
| GET | `/orders/{id}` | emet-getOrder |
| GET | `/orders` | emet-listOrders |
| POST | `/orders/{id}/status` | emet-updateOrderStatus |

- Name the path param exactly `{id}` (handlers read `pathParameters.id`).
- On each resource: **Actions → Enable CORS**.
- **Actions → Deploy API** → stage `prod`.

🔑 Copy the **Invoke URL** (`https://xxxx.execute-api.us-east-1.amazonaws.com/prod`)
= your **VITE_API_BASE**.

✅ In a browser, `GET <invoke>/slots` returns your seeded slots; `GET <invoke>/catalog`
returns your Stripe products (or `{items:[]}` if none yet).

---

# PHASE 8 — Stripe webhook (15 min)

1. Stripe → **Developers → Webhooks → Add endpoint.**
2. **URL:** `<Invoke URL>/stripe-webhook`
3. **Event:** `checkout.session.completed`.
4. Copy the **Signing secret** (`whsec_…`) → set `STRIPE_WEBHOOK_SECRET` on
   `emet-stripeWebhook` → **save**.

✅ Endpoint shows as enabled. (Signature is verified against the raw body; the
handler decodes base64 and never `JSON.parse`s first.)

---

# PHASE 9 — SMS stream trigger (10 min)

On **`emet-notifyOnStatus`**: **Add trigger → DynamoDB** → table `emet_orders`,
**Starting position: Latest**, batch size ~10. (Uses the Stream ARN from Phase 5.)

✅ Trigger shows "Enabled." Texts fire once 10DLC clears; until then, tracking works
and no SMS sends.

---

# PHASE 10 — Connect the frontend, redeploy (10 min)

Amplify → **App settings → Environment variables** → add, then **Redeploy**:
- `VITE_API_BASE` = your Invoke URL (`…/prod`)
- `VITE_STAFF_TOKEN` = the **same** `STAFF_TOKEN` from Phase 6.3

✅ After redeploy: the storefront shows **live Stripe catalog** items with real
images, `/checkout` shows real pickup times, and `/staff` opens with the code.

> Note: `VITE_STAFF_TOKEN` ships to the browser — for v1 it only gates the counter
> view, not real security. Cognito replaces it later (roadmap).

---

# PHASE 11 — End-to-end test (Stripe Test mode) (20 min)

1. Add items → cart → **Checkout** → pick a slot → name + your mobile → **Pay**.
2. Stripe test card **`4242 4242 4242 4242`**, any future expiry / CVC / ZIP.
3. Redirects to `/order/<id>` showing **Order accepted**.

✅ Webhook, not redirect, did it: `emet_orders` row shows `paymentStatus=paid`,
`status=accepted`.
✅ `/staff` shows the paid order; an abandoned checkout does **not** appear.
✅ **Start making → Mark ready** advances `/order/:id` within ~12s; **Mark picked up**
clears it from `/staff`.
✅ A full slot (set `capacity` to 1, book it, retry) returns **409**.
✅ Catalog: a product edited in Stripe (name/image/price) reflects on the storefront.
✅ SMS on `accepted` + `ready` once 10DLC clears.

---

# PHASE 12 — Point the domain via Route 53 (30 min + ⏳ propagation)

**If `emet-vegan.shop` is in Route 53 (or you move DNS there):**
1. Amplify → your app → **Hosting → Custom domains → Add domain** → `emet-vegan.shop`.
2. Accept the ACM cert + DNS records; for Route 53 choose **update automatically**.
3. Map `emet-vegan.shop` (root) → branch, and `www` → redirect to root. Save.
4. Wait for **Available** (15 min–a few hours).

**If DNS stays at your current registrar:** add the domain in Amplify, then copy the
ACM validation CNAME + the app's CNAME/ALIAS records into your registrar's DNS.

Then flip origins to the real domain and redeploy:
- Lambdas: `SITE_URL` + `ALLOWED_ORIGIN` → `https://emet-vegan.shop`.
- Amplify: no change needed (same build), just redeploy after Lambda updates.

✅ `https://emet-vegan.shop` loads the site over HTTPS.

---

# PHASE 13 — Go live (30 min)

- [ ] Stripe → **Live mode**: get `sk_live_…`; add a **live** webhook
      (`<invoke>/stripe-webhook`, `checkout.session.completed`) → update
      `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` on the Lambdas.
- [ ] Move `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STAFF_TOKEN` to **AWS
      Secrets Manager**.
- [ ] Confirm `ALLOWED_ORIGIN` = `https://emet-vegan.shop`; CORS locked to it.
- [ ] Seed real pickup slots for opening day.
- [ ] Owner: add `/staff` to the phone home screen (PWA manifest is included).

🎉 Live.

---

## Environment variable matrix (quick reference)

**Frontend (Amplify):** `VITE_API_BASE`, `VITE_STAFF_TOKEN`
**All HTTP Lambdas:** `ALLOWED_ORIGIN`
**Order/tracking Lambdas:** `ORDERS_TABLE` (+ `SLOTS_TABLE` where noted)
**Stripe Lambdas:** `STRIPE_SECRET_KEY` (+ `STRIPE_WEBHOOK_SECRET` on webhook)
**Checkout/webhook/notify:** `SITE_URL`
**Staff Lambdas:** `STAFF_TOKEN`   ·   **Staff header:** `x-staff-token`

---

## Troubleshooting

- **Storefront shows placeholders, not Stripe photos** → catalog empty or `/catalog`
  not reachable. Test `GET <invoke>/catalog`; check products are **active** with
  images + a default price; confirm `VITE_API_BASE` and redeploy Amplify.
- **Items ungrouped / under "Menu"** → product `metadata.category` doesn't exactly
  match a storefront category string.
- **Checkout: "Unknown item" (400)** → a product's `menu_id` doesn't match a
  `PRICES_CENTS` key (Phase 4.2 box). Fix the metadata or add the slug server-side.
- **`/checkout` shows no times** → slots not seeded, wrong `VITE_API_BASE`, or CORS.
- **Order stuck at `pending_payment`** → webhook not firing: check endpoint URL,
  the `checkout.session.completed` subscription, and `STRIPE_WEBHOOK_SECRET`. Stripe
  → Webhooks shows delivery attempts + errors.
- **`/staff` Unauthorized** → `VITE_STAFF_TOKEN` (Amplify) ≠ `STAFF_TOKEN` (Lambdas);
  redeploy Amplify after changing.
- **CORS errors** → `ALLOWED_ORIGIN` must equal your exact origin (scheme + host, no
  trailing slash); redeploy the API.
- **No SMS** → expected until 10DLC clears; tracker still works.
- **Hero video doesn't autoplay** → must be **muted** + MP4/H.264; large files stall
  (keep < 5 MB or use a CDN URL via `<Hero videoSrc>`).

---

## Roadmap (deferred by design — see `docs/ROADMAP.md`)

- **Delivery fees by ZIP** (30248 $10 · 30252/30253 $14 · 30281 $15 · 30228 $15) —
  add the Pickup/Delivery toggle logic + server-side fee validation.
- **Paid modifiers** (e.g. extra avocado) — needs server-side modifier pricing (same
  work as delivery fees). Modifiers are currently free kitchen notes.
- **Stripe catalog webhook cache** — auto-refresh a menu table on `product.updated`
  (the read path already works without it).
- **Retire `PRICES_CENTS`** — price checkout directly from Stripe price ids so Stripe
  is the single source of truth.
- **Cognito** for `/staff` (replace shared token) · **WebSocket** push (replace
  polling) · **slot auto-release** on expired checkout · full **PWA** service worker.

---

*EMET Vegan Cafe LLC · Bold Flavor. Rooted in Truth. · Good Food. Good Energy. Good Truth.*
