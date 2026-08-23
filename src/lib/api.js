// EMET tracking API client.
//
// Base URL comes from VITE_API_BASE (set in Amplify env vars), e.g.
//   VITE_API_BASE=https://abc123.execute-api.us-east-1.amazonaws.com/prod
// The staff token (VITE_STAFF_TOKEN) is a shared secret for v1 auth on the two
// staff endpoints; it is sent as the x-staff-token header. This is "weekend-fine"
// per the v1.5 spec — replace with Cognito in v1.6.

const BASE = (import.meta.env?.VITE_API_BASE || "").replace(/\/+$/, "");

function url(path) {
  if (!BASE) {
    // Surfacing this early beats a confusing CORS/404 later.
    console.warn("VITE_API_BASE is not set — API calls will fail until it is configured.");
  }
  return `${BASE}${path}`;
}

async function request(path, { method = "GET", body, staffToken } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (staffToken) headers["x-staff-token"] = staffToken;

  const res = await fetch(url(path), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }

  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ---- public endpoints ----
export const getSlots = () => request("/slots");

export const createCheckoutSession = (payload) =>
  request("/checkout-session", { method: "POST", body: payload });

export const getOrder = (id) => request(`/orders/${encodeURIComponent(id)}`);

// ---- staff endpoints (require the shared staff token) ----
export const listOrders = (staffToken) =>
  request("/orders", { staffToken });

export const updateOrderStatus = (id, status, staffToken) =>
  request(`/orders/${encodeURIComponent(id)}/status`, {
    method: "POST",
    body: { status },
    staffToken,
  });

export const STAFF_TOKEN = import.meta.env?.VITE_STAFF_TOKEN || "";

// ---------------------------------------------------------------------------
// Stripe product catalog (dynamic menu).
//
// fetchStripeCatalog() hydrates the storefront from the Stripe Product Catalog.
// It calls a SERVER-SIDE endpoint (GET {API}/catalog → backend listCatalog.mjs)
// that holds STRIPE_SECRET_KEY — never Stripe's /v1/products directly from the
// browser, which would leak the secret key. The server maps Stripe → the shape
// below; if the endpoint isn't configured yet or errors, callers fall back to
// the local MENU so the site still renders.
//
// Field mapping (performed server-side, mirrored here for reference):
//   product.name              -> name
//   product.description       -> description
//   product.images[0]         -> img            (null → ProductCard placeholder)
//   product.metadata.category -> category
//   product.metadata.vendor_id-> vendorId       (filter for single/multi vendor)
//   product.tax_code          -> taxCode        (e.g. txcd_40030001 prepared food)
//   price.unit_amount         -> priceCents      (integer cents)
//   price.id / product.id     -> stripePriceId / stripeProductId
export async function fetchStripeCatalog({ vendorId } = {}) {
  const qs = vendorId ? `?vendor_id=${encodeURIComponent(vendorId)}` : "";
  const data = await request(`/catalog${qs}`);
  const items = Array.isArray(data) ? data : data?.items || [];
  // basic normalization guard so a malformed row can't crash the grid
  return items
    .filter((p) => p && p.id && typeof p.priceCents === "number")
    .map((p) => ({
      id: p.id,
      name: p.name || "Item",
      description: p.description || "",
      priceCents: p.priceCents,
      category: p.category || "Menu",
      img: p.img || null,
      dietary: Array.isArray(p.dietary) ? p.dietary : [],
      options: Array.isArray(p.options) ? p.options : undefined,
      vendorId: p.vendorId || null,
      taxCode: p.taxCode || null,
      stripeProductId: p.stripeProductId || p.id,
      stripePriceId: p.stripePriceId || null,
    }));
}
