// GET /catalog (public) — dynamic menu from the Stripe Product Catalog.
// Holds STRIPE_SECRET_KEY server-side so the browser never touches it. Maps
// Stripe products/prices into the normalized shape the storefront consumes.
//
// Field mapping (per spec):
//   product.name              -> name
//   product.description       -> description
//   product.images[0]         -> img            (null -> ProductCard placeholder)
//   product.metadata.category -> category
//   product.metadata.vendor_id-> vendorId       (optional ?vendor_id= filter)
//   product.tax_code          -> taxCode
//   price.unit_amount         -> priceCents      (integer cents)
//   product.metadata.dietary  -> dietary[]       (comma-separated in Stripe)
//   product.metadata.sort     -> ordering hint (optional)
//
// Set each product's default_price in Stripe. Category comes from metadata so the
// storefront can group without extra config.
import Stripe from "stripe";
import { json, preflight } from "./_lib.mjs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const handler = async (event) => {
  const pre = preflight(event); if (pre) return pre;

  const vendorFilter =
    event.queryStringParameters?.vendor_id ||
    event.queryStringParameters?.vendorId ||
    null;

  try {
    const res = await stripe.products.list({
      active: true,
      limit: 100,
      expand: ["data.default_price"],
    });

    const items = res.data
      .filter((p) => p.default_price && typeof p.default_price === "object")
      .filter((p) => !vendorFilter || (p.metadata?.vendor_id || null) === vendorFilter)
      .map((p) => {
        const price = p.default_price;
        const dietary = (p.metadata?.dietary || "")
          .split(",").map((s) => s.trim()).filter(Boolean);
        return {
          id: p.metadata?.menu_id || p.id,
          name: p.name,
          description: p.description || "",
          priceCents: price.unit_amount,
          category: p.metadata?.category || "Menu",
          img: Array.isArray(p.images) && p.images.length ? p.images[0] : null,
          dietary,
          vendorId: p.metadata?.vendor_id || null,
          taxCode: p.tax_code || null,
          stripeProductId: p.id,
          stripePriceId: price.id,
          _sort: Number(p.metadata?.sort ?? 999),
        };
      })
      .sort((a, b) => a._sort - b._sort)
      .map(({ _sort, ...rest }) => rest);

    return json(200, { items });
  } catch (e) {
    console.error("listCatalog", e);
    return json(502, { error: "Could not load catalog.", items: [] });
  }
};
