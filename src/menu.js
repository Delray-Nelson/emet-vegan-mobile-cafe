// EMET Vegan Cafe — menu data.
//
// This is the LOCAL FALLBACK. In production the storefront hydrates from the
// Stripe product catalog via fetchStripeCatalog() (lib/api.js → backend
// listCatalog.mjs). Item shape here mirrors the normalized shape that mapper
// returns, so components don't care which source they got.
//
// `img` is intentionally null — ProductCard renders a branded placeholder until
// the Stripe catalog supplies product.images[0]. Prices are INTEGER CENTS.
// Modifiers listed here are FREE selections (kitchen notes); paid add-ons are
// deferred to the same server-side pricing work as delivery fees (docs/ROADMAP.md).

export const VENDOR_ID = "emet"; // single vendor for now; Stripe metadata.vendor_id

export const CATEGORIES = ["Smoothies", "Juices", "Wraps & Handhelds", "Nourish Bowls"];

// slug used for category anchor scrolling
export const catId = (c) => c.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const TAX_PREPARED = "txcd_40030001"; // Stripe PTC: prepared food

/** @type {MenuItem[]} */
export const MENU = [
  // ---- Smoothies ($12) — coconut-okra-water base; oat-milk option ----
  { id: "sunrise-tropic-boost", name: "Sunrise Tropic Boost", priceCents: 1200,
    category: "Smoothies", img: null, dietary: ["Plant-based", "GF"],
    description: "Mango, pineapple, orange, banana, ginger, chia, agave.",
    options: [{ label: "Base", choices: ["Coconut okra water", "Oat milk"] }],
    vendorId: VENDOR_ID, taxCode: TAX_PREPARED, stripeProductId: null, stripePriceId: null },
  { id: "royal-berry-recharge", name: "Royal Berry Recharge", priceCents: 1200,
    category: "Smoothies", img: null, dietary: ["Plant-based", "GF"],
    description: "Strawberry, blueberry, apple, banana, chia, agave.",
    options: [{ label: "Base", choices: ["Coconut okra water", "Oat milk"] }],
    vendorId: VENDOR_ID, taxCode: TAX_PREPARED, stripeProductId: null, stripePriceId: null },
  { id: "green-elevation-boost", name: "Green Elevation Boost", priceCents: 1200,
    category: "Smoothies", img: null, dietary: ["Plant-based", "GF"],
    description: "Green apple, kiwi, kale, lemon, ginger, agave.",
    options: [{ label: "Base", choices: ["Coconut okra water", "Oat milk"] }],
    vendorId: VENDOR_ID, taxCode: TAX_PREPARED, stripeProductId: null, stripePriceId: null },
  { id: "emet-georgia-gold", name: "EMET Georgia Gold", priceCents: 1200,
    category: "Smoothies", img: null, dietary: ["Plant-based", "GF"],
    description: "Peaches, carrots, banana, lemon, coconut okra.",
    options: [{ label: "Base", choices: ["Coconut okra water", "Oat milk"] }],
    vendorId: VENDOR_ID, taxCode: TAX_PREPARED, stripeProductId: null, stripePriceId: null },

  // ---- Fresh-Pressed Juices ($10) ----
  { id: "liquid-sunshine", name: "Liquid Sunshine", priceCents: 1000,
    category: "Juices", img: null, dietary: ["Plant-based", "GF"],
    description: "Yellow watermelon, coconut okra water, agave.",
    vendorId: VENDOR_ID, taxCode: TAX_PREPARED, stripeProductId: null, stripePriceId: null },
  { id: "tropical-sunrise", name: "Tropical Sunrise", priceCents: 1000,
    category: "Juices", img: null, dietary: ["Plant-based", "GF"],
    description: "Orange watermelon, coconut okra water, agave.",
    vendorId: VENDOR_ID, taxCode: TAX_PREPARED, stripeProductId: null, stripePriceId: null },

  // ---- Wraps & Handhelds ----
  { id: "emet-garden-wrap", name: "EMET Garden Wrap", priceCents: 1400,
    category: "Wraps & Handhelds", img: null, dietary: ["Plant-based"],
    description: "Cucumber, avocado, cherry tomato, cilantro, crispy vegan chick'n, spinach tortilla.",
    vendorId: VENDOR_ID, taxCode: TAX_PREPARED, stripeProductId: null, stripePriceId: null },
  { id: "emet-rolls", name: "EMET Rolls", priceCents: 600,
    category: "Wraps & Handhelds", img: null, dietary: ["Plant-based"],
    description: "Two vegan egg rolls with sweet dipping sauce.",
    vendorId: VENDOR_ID, taxCode: TAX_PREPARED, stripeProductId: null, stripePriceId: null },
  { id: "emet-street-tacos", name: "EMET Street Tacos", priceCents: 2000,
    category: "Wraps & Handhelds", img: null, dietary: ["Plant-based", "New"],
    description: "Three tacos with shredded lettuce, pico, avocado, beans, cilantro rice.",
    options: [{ label: "Filling", choices: ["Liquid-smoke mushrooms", "Impossible\u2122 ground"] }],
    vendorId: VENDOR_ID, taxCode: TAX_PREPARED, stripeProductId: null, stripePriceId: null },

  // ---- Nourish Bowls ($20) ----
  { id: "vegan-stir-fry-steak-bowl", name: "Vegan Stir-Fry Steak Bowl", priceCents: 2000,
    category: "Nourish Bowls", img: null, dietary: ["Plant-based", "High-protein"],
    description: "Vegan steak, broccoli, peppers, onion, jasmine rice.",
    vendorId: VENDOR_ID, taxCode: TAX_PREPARED, stripeProductId: null, stripePriceId: null },
  { id: "creamy-emet-alfredo-bowl", name: "Creamy EMET Alfredo Bowl", priceCents: 2000,
    category: "Nourish Bowls", img: null, dietary: ["Plant-based"],
    description: "Linguine, house Alfredo, broccoli, mushrooms.",
    vendorId: VENDOR_ID, taxCode: TAX_PREPARED, stripeProductId: null, stripePriceId: null },
];

export const MENU_BY_ID = Object.fromEntries(MENU.map((m) => [m.id, m]));

/** Group items by category, preserving CATEGORIES order (skips empty categories). */
export function groupByCategory(items = MENU) {
  return CATEGORIES
    .map((category) => ({ category, id: catId(category), items: items.filter((m) => m.category === category) }))
    .filter((g) => g.items.length > 0);
}

/** Deterministic placeholder gradient per category (until Stripe images arrive). */
export function placeholderFor(category) {
  switch (category) {
    case "Smoothies": return "radial-gradient(circle at 40% 35%, #F2B24d, #C7761b)";
    case "Juices": return "radial-gradient(circle at 40% 35%, #f0a93a, #d4642a)";
    case "Wraps & Handhelds": return "radial-gradient(circle at 40% 35%, #caa15a, #7a5a2a)";
    case "Nourish Bowls": return "radial-gradient(circle at 40% 35%, #c79a52, #6d4f24)";
    default: return "var(--forest-2)";
  }
}

export const usd = (cents) => `$${(cents / 100).toFixed(2)}`;
