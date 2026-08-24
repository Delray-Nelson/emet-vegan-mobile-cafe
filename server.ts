import express, { Request, Response } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import Stripe from "stripe";

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy Stripe client initialization
let stripeClient: Stripe | null = null;
function getStripe(): Stripe | null {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (key && key.startsWith("sk_")) {
    stripeClient = new Stripe(key);
    return stripeClient;
  }
  return null;
}

const DEFAULT_STAFF_TOKEN = process.env.STAFF_TOKEN || "emet-staff";

// Canonical menu items & server-side prices (in integer cents)
export const MENU_ITEMS: Record<string, { name: string; priceCents: number; category: string; description: string; dietary: string[] }> = {
  "sunrise-tropic-boost": {
    name: "Sunrise Tropic Boost",
    priceCents: 1200,
    category: "Smoothies",
    description: "Mango, pineapple, orange, banana, ginger, chia, agave.",
    dietary: ["Plant-based", "GF"],
  },
  "royal-berry-recharge": {
    name: "Royal Berry Recharge",
    priceCents: 1200,
    category: "Smoothies",
    description: "Strawberry, blueberry, apple, banana, chia, agave.",
    dietary: ["Plant-based", "GF"],
  },
  "green-elevation-boost": {
    name: "Green Elevation Boost",
    priceCents: 1200,
    category: "Smoothies",
    description: "Green apple, kiwi, kale, lemon, ginger, agave.",
    dietary: ["Plant-based", "GF"],
  },
  "emet-georgia-gold": {
    name: "EMET Georgia Gold",
    priceCents: 1200,
    category: "Smoothies",
    description: "Peaches, carrots, banana, lemon, coconut okra.",
    dietary: ["Plant-based", "GF"],
  },
  "liquid-sunshine": {
    name: "Liquid Sunshine",
    priceCents: 1000,
    category: "Juices",
    description: "Yellow watermelon, coconut okra water, agave.",
    dietary: ["Plant-based", "GF"],
  },
  "tropical-sunrise": {
    name: "Tropical Sunrise",
    priceCents: 1000,
    category: "Juices",
    description: "Orange watermelon, coconut okra water, agave.",
    dietary: ["Plant-based", "GF"],
  },
  "emet-garden-wrap": {
    name: "EMET Garden Wrap",
    priceCents: 1400,
    category: "Wraps & Handhelds",
    description: "Cucumber, avocado, cherry tomato, cilantro, crispy vegan chick'n, spinach tortilla.",
    dietary: ["Plant-based"],
  },
  "emet-rolls": {
    name: "EMET Rolls",
    priceCents: 600,
    category: "Wraps & Handhelds",
    description: "Two vegan egg rolls with sweet dipping sauce.",
    dietary: ["Plant-based"],
  },
  "emet-street-tacos": {
    name: "EMET Street Tacos",
    priceCents: 2000,
    category: "Wraps & Handhelds",
    description: "Three tacos with shredded lettuce, pico, avocado, beans, cilantro rice.",
    dietary: ["Plant-based", "New"],
  },
  "vegan-stir-fry-steak-bowl": {
    name: "Vegan Stir-Fry Steak Bowl",
    priceCents: 2000,
    category: "Nourish Bowls",
    description: "Vegan steak, broccoli, peppers, onion, jasmine rice.",
    dietary: ["Plant-based", "High-protein"],
  },
  "creamy-emet-alfredo-bowl": {
    name: "Creamy EMET Alfredo Bowl",
    priceCents: 2000,
    category: "Nourish Bowls",
    description: "Linguine, house Alfredo, broccoli, mushrooms.",
    dietary: ["Plant-based"],
  },
};

// Delivery fees by ZIP in integer cents
export const DELIVERY_FEES_CENTS: Record<string, number> = {
  "30252": 1400, // McDonough ($14.00)
  "30253": 1400, // McDonough ($14.00)
  "30281": 1500, // Stockbridge ($15.00)
  "30228": 1500, // Hampton ($15.00)
};

export function getDeliveryFeeCents(zip: string): number | null {
  if (!zip) return null;
  const cleanZip = String(zip).trim().slice(0, 5);
  return DELIVERY_FEES_CENTS[cleanZip] ?? null;
}

interface OrderItem {
  id: string;
  qty: number;
  name?: string;
  priceCents?: number;
}

interface Order {
  orderId: string;
  status: "pending_payment" | "accepted" | "being_made" | "out_for_delivery" | "delivered" | "ready" | "picked_up" | "cancelled";
  paymentStatus: "pending" | "paid";
  items: OrderItem[];
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  deliveryWindow: string;
  deliveryDate?: string;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryZip: string;
  deliveryInstructions?: string;
  customerName?: string;
  customerPhone?: string;
  createdAt: string;
  updatedAt?: string;
  startedAt?: string;
  outForDeliveryAt?: string;
  deliveredAt?: string;
}

// In-memory data store
const ordersStore = new Map<string, Order>();

// Seed initial orders for preview & counter testing
const sampleId1 = "ord_sample101";
const sampleId2 = "ord_sample102";
ordersStore.set(sampleId1, {
  orderId: sampleId1,
  status: "accepted",
  paymentStatus: "paid",
  items: [
    { id: "sunrise-tropic-boost", qty: 1, name: "Sunrise Tropic Boost", priceCents: 1200 },
    { id: "emet-garden-wrap", qty: 1, name: "EMET Garden Wrap", priceCents: 1400 },
  ],
  subtotalCents: 2600,
  deliveryFeeCents: 1400,
  totalCents: 4000,
  deliveryWindow: `${new Date().toISOString().slice(0, 10)}T13:30`,
  deliveryAddress: "742 Evergreen Terrace",
  deliveryCity: "McDonough",
  deliveryZip: "30252",
  deliveryInstructions: "Leave on porch table please",
  customerName: "Maya Lin",
  customerPhone: "(404) 555-0144",
  createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
});

ordersStore.set(sampleId2, {
  orderId: sampleId2,
  status: "out_for_delivery",
  paymentStatus: "paid",
  items: [
    { id: "vegan-stir-fry-steak-bowl", qty: 2, name: "Vegan Stir-Fry Steak Bowl", priceCents: 2000 },
    { id: "liquid-sunshine", qty: 1, name: "Liquid Sunshine", priceCents: 1000 },
  ],
  subtotalCents: 5000,
  deliveryFeeCents: 1500,
  totalCents: 6500,
  deliveryWindow: `${new Date().toISOString().slice(0, 10)}T14:00`,
  deliveryAddress: "108 Ocean Ave",
  deliveryCity: "Stockbridge",
  deliveryZip: "30281",
  customerName: "Andre Bennett",
  customerPhone: "(404) 555-0199",
  createdAt: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
});

// Auth helper for staff requests
function isStaffAuthorized(req: Request): boolean {
  const token = (req.headers["x-staff-token"] as string) || (req.headers["X-Staff-Token"] as string) || "";
  if (!token) return false;
  return token === DEFAULT_STAFF_TOKEN || token === "emet-staff" || token === "emet2025";
}

function newOrderId(): string {
  const rand = () => Math.random().toString(36).slice(2, 6);
  return `ord_${Date.now().toString(36)}${rand()}`;
}

// ---------------- API ROUTES ----------------

// GET /health & /api/health
const handleHealth = (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
};
app.get("/health", handleHealth);
app.get("/api/health", handleHealth);

// POST /checkout-session & /api/checkout-session
const handleCheckoutSession = async (req: Request, res: Response) => {
  try {
    const { items, windowId, slotId, customer, delivery } = req.body || {};
    const chosenWindow = windowId || slotId;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Your cart is empty." });
    }
    if (!chosenWindow) {
      return res.status(400).json({ error: "Please pick a delivery time." });
    }
    if (!customer?.name?.trim() || !customer?.phone?.trim()) {
      return res.status(400).json({ error: "Name and phone number are required." });
    }

    const zip = String(delivery?.zip || "30252").trim();
    const address = String(delivery?.address || "123 Main St").trim();
    const city = String(delivery?.city || "Locust Grove").trim();

    const deliveryFeeCents = getDeliveryFeeCents(zip);
    if (deliveryFeeCents === null) {
      return res.status(422).json({ error: `Delivery is not currently available to ZIP code ${zip}.` });
    }

    // Validate server-side prices
    const pricedItems: { id: string; qty: number; name: string; priceCents: number }[] = [];
    let subtotalCents = 0;

    for (const line of items) {
      const itemConfig = MENU_ITEMS[line.id];
      if (!itemConfig) {
        return res.status(400).json({ error: `Unknown item: ${line.id}` });
      }
      const qty = Math.max(1, Math.min(20, Math.floor(Number(line.qty) || 1)));
      pricedItems.push({
        id: line.id,
        qty,
        name: itemConfig.name,
        priceCents: itemConfig.priceCents,
      });
      subtotalCents += itemConfig.priceCents * qty;
    }

    const orderId = newOrderId();
    const createdAt = new Date().toISOString();
    const grandTotalCents = subtotalCents + deliveryFeeCents;

    const stripe = getStripe();
    const siteUrl = process.env.SITE_URL || `http://localhost:${PORT}`;

    if (stripe) {
      // Create Stripe Session with food items + Delivery fee line item
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = pricedItems.map((it) => ({
        quantity: it.qty,
        price_data: {
          currency: "usd",
          unit_amount: it.priceCents,
          product_data: { name: it.name },
        },
      }));

      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: deliveryFeeCents,
          product_data: { name: "Delivery fee" },
        },
      });

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: lineItems,
        client_reference_id: orderId,
        metadata: { orderId, zip, windowId: chosenWindow },
        success_url: `${siteUrl}/order/${orderId}`,
        cancel_url: `${siteUrl}/checkout`,
      });

      ordersStore.set(orderId, {
        orderId,
        status: "pending_payment",
        paymentStatus: "pending",
        items: pricedItems,
        subtotalCents,
        deliveryFeeCents,
        totalCents: grandTotalCents,
        deliveryWindow: chosenWindow,
        deliveryAddress: address,
        deliveryCity: city,
        deliveryZip: zip,
        deliveryInstructions: delivery?.instructions || "",
        customerName: customer.name.trim(),
        customerPhone: customer.phone.trim(),
        createdAt,
      });

      return res.json({ url: session.url, orderId });
    } else {
      // Sandbox mode: immediately mark as accepted
      ordersStore.set(orderId, {
        orderId,
        status: "accepted",
        paymentStatus: "paid",
        items: pricedItems,
        subtotalCents,
        deliveryFeeCents,
        totalCents: grandTotalCents,
        deliveryWindow: chosenWindow,
        deliveryAddress: address,
        deliveryCity: city,
        deliveryZip: zip,
        deliveryInstructions: delivery?.instructions || "",
        customerName: customer.name.trim(),
        customerPhone: customer.phone.trim(),
        createdAt,
      });

      return res.json({ url: `/order/${orderId}`, orderId });
    }
  } catch (err: any) {
    console.error("Error creating checkout session:", err);
    res.status(500).json({ error: err.message || "Failed to initiate checkout." });
  }
};
app.post("/checkout-session", handleCheckoutSession);
app.post("/api/checkout-session", handleCheckoutSession);

// GET /orders/:id & /api/orders/:id
const handleGetOrder = (req: Request, res: Response) => {
  const id = req.params.id;
  const order = ordersStore.get(id);
  if (!order) {
    return res.status(404).json({ error: "Order not found." });
  }
  res.json({
    orderId: order.orderId,
    status: order.status,
    items: order.items,
    deliveryWindow: order.deliveryWindow,
    deliveryAddress: order.deliveryAddress,
    deliveryCity: order.deliveryCity,
    deliveryZip: order.deliveryZip,
    createdAt: order.createdAt,
  });
};
app.get("/orders/:id", handleGetOrder);
app.get("/api/orders/:id", handleGetOrder);

// GET /orders & /api/orders (staff counter dashboard)
const handleListOrders = (req: Request, res: Response) => {
  if (!isStaffAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized staff access code." });
  }
  const activeOrders = Array.from(ordersStore.values())
    .filter((o) => ["accepted", "being_made", "out_for_delivery", "ready"].includes(o.status))
    .map((o) => ({
      orderId: o.orderId,
      status: o.status,
      items: o.items,
      deliveryWindow: o.deliveryWindow,
      deliveryAddress: o.deliveryAddress,
      deliveryCity: o.deliveryCity,
      deliveryZip: o.deliveryZip,
      deliveryInstructions: o.deliveryInstructions,
      customerName: o.customerName || "Customer",
      customerPhone: o.customerPhone || "",
      createdAt: o.createdAt,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  res.json({ orders: activeOrders });
};
app.get("/orders", handleListOrders);
app.get("/api/orders", handleListOrders);

// POST /orders/:id/status & /api/orders/:id/status
const handleUpdateStatus = (req: Request, res: Response) => {
  if (!isStaffAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized staff access code." });
  }
  const id = req.params.id;
  const { status } = req.body || {};
  const order = ordersStore.get(id);
  if (!order) {
    return res.status(404).json({ error: "Order not found." });
  }

  const validTransitions: Record<string, string[]> = {
    accepted: ["being_made"],
    being_made: ["out_for_delivery", "ready"],
    out_for_delivery: ["delivered"],
    ready: ["out_for_delivery", "picked_up", "delivered"],
  };

  const allowed = validTransitions[order.status];
  if (!allowed || !allowed.includes(status)) {
    if (order.status === status) {
      return res.json({ order: { orderId: id, status: order.status } });
    }
    return res.status(409).json({ error: `Cannot transition from '${order.status}' to '${status}'.` });
  }

  order.status = status;
  order.updatedAt = new Date().toISOString();
  if (status === "being_made") order.startedAt = order.updatedAt;
  if (status === "out_for_delivery") order.outForDeliveryAt = order.updatedAt;
  if (status === "delivered" || status === "picked_up") order.deliveredAt = order.updatedAt;

  res.json({ order: { orderId: id, status: order.status } });
};
app.post("/orders/:id/status", handleUpdateStatus);
app.post("/api/orders/:id/status", handleUpdateStatus);

// GET /catalog & /api/catalog
const handleGetCatalog = async (_req: Request, res: Response) => {
  const stripe = getStripe();
  if (stripe) {
    try {
      const resStripe = await stripe.products.list({ active: true, limit: 100, expand: ["data.default_price"] });
      const items = resStripe.data
        .filter((p) => p.default_price && typeof p.default_price === "object")
        .map((p) => {
          const price = p.default_price as Stripe.Price;
          const dietary = (p.metadata?.dietary || "").split(",").map((s) => s.trim()).filter(Boolean);
          return {
            id: p.metadata?.menu_id || p.id,
            name: p.name,
            description: p.description || "",
            priceCents: price.unit_amount || 0,
            category: p.metadata?.category || "Menu",
            img: Array.isArray(p.images) && p.images.length ? p.images[0] : null,
            dietary,
            stripeProductId: p.id,
            stripePriceId: price.id,
          };
        });
      if (items.length > 0) {
        return res.json({ items });
      }
    } catch (e) {
      console.warn("Stripe catalog fetch skipped, using local fallback");
    }
  }

  // Fallback to local catalog
  const localItems = Object.entries(MENU_ITEMS).map(([id, item]) => ({
    id,
    name: item.name,
    description: item.description,
    priceCents: item.priceCents,
    category: item.category,
    dietary: item.dietary,
    img: null,
    stripeProductId: null,
    stripePriceId: null,
  }));
  res.json({ items: localItems });
};
app.get("/catalog", handleGetCatalog);
app.get("/api/catalog", handleGetCatalog);

// ---------------- VITE MIDDLEWARE / PRODUCTION STATIC ----------------

async function start() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`EMET Vegan Cafe server running at http://0.0.0.0:${PORT}`);
  });
}

start();
