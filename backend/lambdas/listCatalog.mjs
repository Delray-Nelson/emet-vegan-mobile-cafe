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

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// Curated fallback menu items if Stripe is empty or inaccessible
const CURATED_FALLBACK = [
  { id: "sunrise-tropic-boost", name: "Sunrise Tropic Boost", priceCents: 1200, category: "Smoothies", img: null, dietary: ["Plant-based", "GF"], description: "Mango, pineapple, orange, banana, ginger, chia, agave.", options: [{ label: "Base", choices: ["Coconut okra water", "Oat milk"] }] },
  { id: "royal-berry-recharge", name: "Royal Berry Recharge", priceCents: 1200, category: "Smoothies", img: null, dietary: ["Plant-based", "GF"], description: "Strawberry, blueberry, apple, banana, chia, agave.", options: [{ label: "Base", choices: ["Coconut okra water", "Oat milk"] }] },
  { id: "green-elevation-boost", name: "Green Elevation Boost", priceCents: 1200, category: "Smoothies", img: null, dietary: ["Plant-based", "GF"], description: "Green apple, kiwi, kale, lemon, ginger, agave.", options: [{ label: "Base", choices: ["Coconut okra water", "Oat milk"] }] },
  { id: "emet-georgia-gold", name: "EMET Georgia Gold", priceCents: 1200, category: "Smoothies", img: null, dietary: ["Plant-based", "GF"], description: "Peaches, carrots, banana, lemon, coconut okra.", options: [{ label: "Base", choices: ["Coconut okra water", "Oat milk"] }] },
  { id: "liquid-sunshine", name: "Liquid Sunshine", priceCents: 1000, category: "Juices", img: null, dietary: ["Plant-based", "GF"], description: "Yellow watermelon, coconut okra water, agave." },
  { id: "tropical-sunrise", name: "Tropical Sunrise", priceCents: 1000, category: "Juices", img: null, dietary: ["Plant-based", "GF"], description: "Orange watermelon, coconut okra water, agave." },
  { id: "emet-garden-wrap", name: "EMET Garden Wrap", priceCents: 1400, category: "Wraps & Handhelds", img: null, dietary: ["Plant-based"], description: "Cucumber, avocado, cherry tomato, cilantro, crispy vegan chick'n, spinach tortilla." },
  { id: "emet-rolls", name: "EMET Rolls", priceCents: 600, category: "Wraps & Handhelds", img: null, dietary: ["Plant-based"], description: "Two vegan egg rolls with sweet dipping sauce." },
  { id: "emet-street-tacos", name: "EMET Street Tacos", priceCents: 2000, category: "Wraps & Handhelds", img: null, dietary: ["Plant-based", "New"], description: "Three tacos with shredded lettuce, pico, avocado, beans, cilantro rice.", options: [{ label: "Filling", choices: ["Liquid-smoke mushrooms", "Impossible™ ground"] }] },
  { id: "vegan-stir-fry-steak-bowl", name: "Vegan Stir-Fry Steak Bowl", priceCents: 2000, category: "Nourish Bowls", img: null, dietary: ["Plant-based", "High-protein"], description: "Vegan steak, broccoli, peppers, onion, jasmine rice." },
  { id: "creamy-emet-alfredo-bowl", name: "Creamy EMET Alfredo Bowl", priceCents: 2000, category: "Nourish Bowls", img: null, dietary: ["Plant-based"], description: "Linguine, house Alfredo, broccoli, mushrooms." },
];

export const handler = async (event) => {
  const pre = preflight(event); if (pre) return pre;

  const vendorFilter =
    event.queryStringParameters?.vendor_id ||
    event.queryStringParameters?.vendorId ||
    null;

  if (!stripe) {
    return json(200, { items: CURATED_FALLBACK, source: "curated_fallback" }, event);
  }

  try {
    const res = await stripe.products.list({
      active: true,
      limit: 100,
      expand: ["data.default_price"],
    });

    const activeProducts = res.data.filter((p) => p.default_price && typeof p.default_price === "object");

    if (!activeProducts.length) {
      return json(200, { items: CURATED_FALLBACK, source: "curated_fallback" }, event);
    }

    const filtered = activeProducts.filter(
      (p) => !vendorFilter || !p.metadata?.vendor_id || p.metadata?.vendor_id === vendorFilter
    );

    const itemsToMap = filtered.length ? filtered : activeProducts;

    const items = itemsToMap
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

    return json(200, { items, source: "stripe" }, event);
  } catch (e) {
    console.error("listCatalog error, falling back to curated:", e);
    return json(200, { items: CURATED_FALLBACK, source: "curated_fallback" }, event);
  }
};
