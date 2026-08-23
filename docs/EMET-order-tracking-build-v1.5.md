# EMET Order Tracking — Build Guide (v1.5)

**Business:** EMET Vegan Cafe — mobile cafe, order-ahead + pickup
**Domain:** emet-vegan.shop · **Hosting:** AWS Amplify (existing)
**Stack:** React (Vite) · Stripe Checkout · DynamoDB · Lambda · API Gateway · SNS (SMS)
**Goal:** a customer pays in Stripe, the owner sees the order and taps it through
three stages, and the customer is notified automatically at each stage.

> This is the **tracking module**. It's a self-contained version you can build and
> ship on its own, then reuse. The starter code referenced throughout lives beside
> this file in `frontend/` and `backend/`.

---

## 1. The chain (how it all connects)

```
[ Customer pays ] ──► STRIPE
                        │  checkout.session.completed (webhook)
                        ▼
                 [ Your backend ]  ── writes order: paymentStatus=paid, status=accepted
                        │
          ┌─────────────┴───────────────┐
          ▼                             ▼
 [ Owner /staff dashboard ]     [ Customer /order/:id page ]
   sees the PAID order,           shows the growing 3-stage
   taps Start → Ready             tracker, updates as status changes
          │                             ▲
          └── each tap updates the order row ──┘
                        │
                        ▼
             DynamoDB Streams ──► SNS ──► SMS to customer
```

**Two things to internalize:**

1. **Stripe is the trigger, not the delivery system.** Stripe only tells *your
   backend* that payment succeeded. Your backend is what makes the order appear on
   the dashboard and what sends the customer's texts.
2. **The order appears for the owner on `paid`, not on checkout-click.** Tie the
   dashboard to `paymentStatus = paid` (set by the webhook) so abandoned checkouts
   never show up as ghost orders.

---

## 2. The status model

Five states. The customer sees **three**; the last customer-facing one plus an
internal one keep the owner's queue clean.

| status | who sets it | customer sees | texts customer? |
|---|---|---|---|
| `pending_payment` | createCheckoutSession | (nothing yet) | no |
| `accepted` | Stripe webhook (paid) | **Order accepted** | ✅ short confirm |
| `being_made` | owner taps *Start making* | **Order being made** | no (avoid over-pinging) |
| `ready` | owner taps *Mark ready* | **Ready for pickup** | ✅ the important one |
| `picked_up` | owner taps *Mark picked up* | (clears) | no |
| `cancelled` | owner/refund | (clears) | optional |

The owner taps **twice** in the normal path (Start, Ready) plus a housekeeping
*Picked up* to clear the card. `accepted` is automatic off the payment.

---

## 3. Architecture — one app, not two

The owner dashboard is **a protected route in the same React app**, not a separate
build. Same codebase, same Amplify deployment.

```
emet-vegan.shop/              customer — menu + checkout
emet-vegan.shop/order/:id     customer — tracking page (Stripe success_url)
emet-vegan.shop/staff         owner — dashboard, behind login
```

Both screens read/write the **same DynamoDB order row** — that shared row is the
only thing connecting them. The owner just opens `/staff` in the truck, logs in
once, and works from the phone. Nothing to install.

**Optional PWA (recommended, ~1 hr):** add a web app manifest + service worker so
the owner can "Add to Home Screen" and `/staff` gets an app icon and launches
full-screen. A genuinely separate app or a dedicated kitchen-display tablet is only
worth it at high volume — not a v1 concern.

---

## Prerequisites (one has a multi-day clock)

- [ ] **Start A2P 10DLC registration in AWS/Twilio today.** US app-to-person SMS
      needs carrier registration; it takes days and is out of your control.
      In-app tracking works without it — texts switch on when it clears, no code
      change. *Start this before writing code.*
- [ ] Stripe account (test-mode keys to start).
- [ ] AWS CLI configured; pick one **region** (e.g. `us-east-1`) and use it everywhere.
- [ ] Node 18+ locally.

---

## Phase 1 — DynamoDB (~30 min)

**Table `emet_orders`**
- Partition key: `orderId` (string)
- **Enable Streams** → *New and old images* (drives the SMS trigger)
- **GSI `status-createdAt-index`**: PK `status`, SK `createdAt` (lets the dashboard
  pull active orders without scanning the whole table)

**Table `emet_slots`** (pickup windows)
- Partition key: `slotId` (e.g. `2026-08-23T12:30`)
- Attributes: `capacity`, `booked`, `leadMinutes`, `date`, `time`

```bash
aws dynamodb create-table --table-name emet_orders \
  --attribute-definitions AttributeName=orderId,AttributeType=S AttributeName=status,AttributeType=S AttributeName=createdAt,AttributeType=S \
  --key-schema AttributeName=orderId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES \
  --global-secondary-indexes '[{"IndexName":"status-createdAt-index","KeySchema":[{"AttributeName":"status","KeyType":"HASH"},{"AttributeName":"createdAt","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]'

aws dynamodb create-table --table-name emet_slots \
  --attribute-definitions AttributeName=slotId,AttributeType=S \
  --key-schema AttributeName=slotId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

Seed a couple days of slots manually to start.

---

## Phase 2 — Lambdas + API Gateway (~3–4 hrs)

Create a **REST API** (Lambda proxy integration), CORS locked to your origin.
Handlers are in `backend/lambdas/`.

| Method | Path | Handler | Auth |
|---|---|---|---|
| GET | `/slots` | `getSlots.mjs` | public |
| POST | `/checkout-session` | `createCheckoutSession.mjs` | public |
| POST | `/stripe-webhook` | `stripeWebhook.mjs` | Stripe sig |
| GET | `/orders/{id}` | `getOrder.mjs` | public (unguessable id) |
| GET | `/orders` | `listOrders.mjs` | **staff** |
| POST | `/orders/{id}/status` | `updateOrderStatus.mjs` | **staff** |

Stream trigger (no API route):
- `notifyOnStatus.mjs` — attached to the `emet_orders` DynamoDB Stream.

**Secrets:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STAFF_TOKEN` as
Lambda env vars for the weekend; move to Secrets Manager before real launch.

**IAM:** each Lambda gets only what it uses — `GetItem`/`PutItem`/`UpdateItem`/
`Query` on the tables it touches, plus `sns:Publish` for `notifyOnStatus`, plus the
DynamoDB Streams read permissions on that one function.

Key rules baked into the handlers:
- `createCheckoutSession` writes `paymentStatus:"pending"`, `status:"pending_payment"`,
  validates the slot **server-side**, and computes price server-side (never trust
  the client).
- `stripeWebhook` verifies the signature against the **raw body**, then flips the
  order to `paymentStatus:"paid"`, `status:"accepted"` — this is the moment it
  appears for the owner and the "accepted" text fires.
- `listOrders` returns only active paid statuses (`accepted`, `being_made`, `ready`).

---

## Phase 3 — Stripe webhook wiring (~30 min)

1. Deploy `stripeWebhook` behind `POST /stripe-webhook`.
2. In **Stripe → Developers → Webhooks**, add the endpoint URL, subscribe to
   `checkout.session.completed`, copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Enable **email receipts** in Stripe (dashboard → settings) so Stripe sends the
   receipt automatically.

> Gotcha: verify the signature on the **raw** body. If API Gateway sets
> `isBase64Encoded`, decode before verifying. Never `JSON.parse` first.

---

## Phase 4 — Frontend routes + tracking page (~2–3 hrs)

Add `react-router-dom`. Files are in `frontend/src/`.

- `styles/tokens.css` — the official EMET palette + type, imported once.
- `lib/api.js` — the fetch client (set `VITE_API_BASE`).
- `components/OrderTracker.jsx` — the customer tracking page. Fetches
  `GET /orders/:id`, renders the growing 3-stage stem, and **polls every 12s**.
  This is the Stripe `success_url` target (`/order/:id`).
- `components/Checkout.jsx` — the slot picker + "Pay" button that calls
  `POST /checkout-session` and redirects to the returned Stripe URL.

Router:
```jsx
<Routes>
  <Route path="/" element={<Menu/>} />
  <Route path="/checkout" element={<Checkout/>} />
  <Route path="/order/:id" element={<OrderTracker/>} />
  <Route path="/staff" element={<StaffDashboard/>} />
</Routes>
```

---

## Phase 5 — Staff dashboard + auth (~1.5 hrs)

- `components/StaffDashboard.jsx` — lists active orders (`GET /orders`), each a card
  with the relabeling action button (Start making → Mark ready → Mark picked up).
  Polls every ~8s so new paid orders appear on their own.
- **Auth for v1:** a shared `STAFF_TOKEN`. The dashboard sends it as a header; the
  staff Lambdas reject requests without it. Replace with **Cognito** hosted UI in
  v1.6. (Weekend-fine; not launch-forever-fine.)

---

## Phase 6 — SMS automation (~1.5 hrs)

- `notifyOnStatus.mjs` — triggered by the `emet_orders` Stream. On a status change,
  it sends the matching message via **SNS** (set SMS type = **Transactional**).
  Texts on `accepted` and `ready` only.
- Give its role `sns:Publish`.
- Until 10DLC clears, texts may not deliver to unverified numbers — **in-app
  tracking still works.** No code change when registration completes.

---

## Phase 7 — EMET rebrand (already in the components)

`tokens.css` carries the official brand kit:

```css
:root{
  --gold:#D4AF37;      /* headings, CTAs, highlights */
  --green:#72BF44;     /* badges, success, secondary CTA */
  --obsidian:#0A0D0A;  /* canvas, cards */
  --forest:#141A14;    /* elevated surfaces, modals */
  --border:#222E22;
  --ink:#E2E8F0;
  --font-brand:Georgia, serif;              /* uppercase gold wordmark */
  --font-sub:'Helvetica Neue',Arial,sans-serif;  /* tracked green subheads */
  --font-body:system-ui,sans-serif;
}
```

---

## Phase 8 — PWA for the owner (optional, ~1 hr)

Add `public/manifest.webmanifest` (name, icons, `display:standalone`,
`start_url:/staff`) and a minimal service worker. The owner taps "Add to Home
Screen" and `/staff` behaves like an installed app.

---

## Launch checklist

- [ ] Test order in Stripe **test mode** (card `4242 4242 4242 4242`).
- [ ] Webhook flips the order to `accepted` (confirm it's the webhook, not the redirect).
- [ ] Paid order appears on `/staff`; an abandoned checkout does **not**.
- [ ] Tap Start → Ready; tracking page advances (poll) and SMS fires (once 10DLC clears).
- [ ] Full slot is rejected server-side (409).
- [ ] Move Stripe keys to **Secrets Manager**; lock CORS to `https://emet-vegan.shop`.
- [ ] Swap to **live** Stripe keys + register the live webhook.

---

## Deferred to v1.6

- **WebSocket API** for instant push (order pings onto the dashboard the moment
  it's paid; tracking updates with no poll). Hardest AWS piece — polling is fine to launch.
- **Cognito** replacing the shared-secret staff auth.
- **Slot auto-release** on `checkout.session.expired`.
- Cancellation/refund customer text.

---

## File map

```
frontend/src/
  styles/tokens.css          brand tokens + shared component CSS
  lib/api.js                 fetch client for all endpoints
  components/OrderTracker.jsx customer 3-stage tracking page (polls)
  components/StaffDashboard.jsx owner dashboard (polls, staff token)
  components/Checkout.jsx     slot pick + Stripe redirect
backend/lambdas/
  createCheckoutSession.mjs  validate slot, create session + pending order
  stripeWebhook.mjs          verify sig, mark paid + accepted
  getOrder.mjs               tracking page read
  listOrders.mjs             active paid orders for the dashboard
  updateOrderStatus.mjs      owner advances status
  notifyOnStatus.mjs         Stream → SNS SMS on accepted & ready
```
