# EMET — Roadmap / Deferred work

Things captured but **not built yet**, so the code that's shipping stays clean.

---

## 1. Delivery fees (client request — targeted for tomorrow)

**Not implemented.** v1 is pickup-only. When we add delivery, here's the plan.

**Recommendation: charge by ZIP code, not city name.** City names are ambiguous at
borders and on typed delivery addresses; a ZIP is unambiguous and easy to validate.
Your two lists line up cleanly onto ZIPs, so nothing is lost:

| ZIP | Area | Fee |
|---|---|---|
| 30248 | Locust Grove | $10 |
| 30252, 30253 | McDonough | $14 |
| 30281 | Stockbridge | $15 |
| 30228 | Hampton | $15 |

Ready-to-wire data (drop into `src/delivery.js` + mirror in `backend/lambdas/_lib.mjs`
for server-side validation — the fee, like item prices, must be computed server-side):

```js
// fees in integer cents, keyed by ZIP
export const DELIVERY_FEES_CENTS = {
  "30248": 1000, // Locust Grove
  "30252": 1400, // McDonough
  "30253": 1400, // McDonough
  "30281": 1500, // Stockbridge
  "30228": 1500, // Hampton
};
export const deliveryFeeCents = (zip) => DELIVERY_FEES_CENTS[String(zip).trim()] ?? null;
// null → "we don't deliver to that ZIP yet" (block checkout with a clear message)
```

Checkout changes when we build it: add a **Pickup / Delivery** toggle; on delivery,
collect the address + ZIP, look up the fee, show it as a line item, and add it to
the Stripe session as its own `line_item` (so the receipt itemizes it). Reject
unknown ZIPs before creating the session.

---

## 2. Stripe product-catalog image + price sync (client has the Stripe API)

**Not implemented.** Today the menu lives in `src/menu.js` with inline cropped
photos (`src/images.js`) and hard-coded `priceCents`; the backend mirrors prices in
`_lib.mjs`. The menu shape was built to make the swap painless:

- Every item in `menu.js` already carries `stripeProductId` / `stripePriceId`
  (currently `null`) and an `img` field.
- Plan: a small sync (webhook on `product.updated` / `price.updated`, or a periodic
  pull) writes the catalog into a `emet_menu` DynamoDB table — name, active price id,
  unit amount, and the Stripe-hosted image URL. The frontend fetches that at load
  (or it's baked at build), and `img` points at the Stripe image instead of the
  inline data URI.
- Once live, prices come from Stripe as the single source of truth:
  `createCheckoutSession` uses each line's `stripePriceId` directly instead of the
  `PRICES_CENTS` mirror, removing the duplicate price list entirely.

Nothing consuming `menu.js` needs to change — keep the exported shape stable.

---

## 3. From the v1.5 spec, already deferred to v1.6

- **WebSocket API** for instant push (no polling on tracker/dashboard).
- **Cognito** hosted UI replacing the shared staff token.
- **Slot auto-release** on `checkout.session.expired` (today a slot is reserved at
  checkout and only freed manually if a checkout is abandoned).
- Cancellation/refund customer text.
- **PWA** for `/staff` ("Add to Home Screen") — `public/manifest.webmanifest` is
  already in place; add a minimal service worker to finish it.
