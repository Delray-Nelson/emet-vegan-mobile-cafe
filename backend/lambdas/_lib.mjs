// Shared helpers for the EMET tracking Lambdas.
// Kept tiny and dependency-light. AWS SDK v3 is preinstalled in the Lambda
// Node 18/20 runtime; only `stripe` needs bundling (see backend/package.json).

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const REGION = process.env.AWS_REGION || "us-east-1";
export const ORDERS_TABLE = process.env.ORDERS_TABLE || "emet_orders";
export const SLOTS_TABLE = process.env.SLOTS_TABLE || "emet_slots";

const ddb = new DynamoDBClient({ region: REGION });
export const doc = DynamoDBDocumentClient.from(ddb, {
  marshallOptions: { removeUndefinedValues: true },
});

// CORS locked to the live origin (set ALLOWED_ORIGIN in Lambda env).
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://emet-vegan.shop";
export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, x-staff-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

export function json(statusCode, body) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

// API Gateway (proxy) preflight helper.
export function preflight(event) {
  const method = event?.requestContext?.http?.method || event?.httpMethod;
  if (method === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  return null;
}

// Read + parse the request body, honoring API Gateway base64 encoding.
export function rawBody(event) {
  if (!event.body) return "";
  return event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
}
export function parseBody(event) {
  const raw = rawBody(event);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// Shared-secret staff auth (v1). Returns true if the caller is authorized.
export function isStaff(event) {
  const token =
    event.headers?.["x-staff-token"] ||
    event.headers?.["X-Staff-Token"] ||
    "";
  const expected = process.env.STAFF_TOKEN || "";
  return !!expected && token === expected;
}

// SERVER-SIDE prices, in integer cents. Never trust client-sent amounts.
export const PRICES_CENTS = {
  "sunrise-tropic-boost": 1200,
  "royal-berry-recharge": 1200,
  "green-elevation-boost": 1200,
  "emet-georgia-gold": 1200,
  "liquid-sunshine": 1000,
  "tropical-sunrise": 1000,
  "emet-garden-wrap": 1400,
  "emet-rolls": 600,
  "emet-street-tacos": 2000,
  "vegan-stir-fry-steak-bowl": 2000,
  "creamy-emet-alfredo-bowl": 2000,
};
export const NAMES = {
  "sunrise-tropic-boost": "Sunrise Tropic Boost",
  "royal-berry-recharge": "Royal Berry Recharge",
  "green-elevation-boost": "Green Elevation Boost",
  "emet-georgia-gold": "EMET Georgia Gold",
  "liquid-sunshine": "Liquid Sunshine",
  "tropical-sunrise": "Tropical Sunrise",
  "emet-garden-wrap": "EMET Garden Wrap",
  "emet-rolls": "EMET Rolls",
  "emet-street-tacos": "EMET Street Tacos",
  "vegan-stir-fry-steak-bowl": "Vegan Stir-Fry Steak Bowl",
  "creamy-emet-alfredo-bowl": "Creamy EMET Alfredo Bowl",
};

// Delivery fees by ZIP in integer cents
export const DELIVERY_FEES_CENTS = {
  "30252": 1400, // McDonough ($14.00)
  "30253": 1400, // McDonough ($14.00)
  "30281": 1500, // Stockbridge ($15.00)
  "30228": 1500, // Hampton ($15.00)
};

export function getDeliveryFeeCents(zip) {
  if (!zip) return null;
  const cleanZip = String(zip).trim().slice(0, 5);
  return DELIVERY_FEES_CENTS[cleanZip] ?? null;
}

// Business operating hours (America/New_York)
// Tue–Thu 12:00–20:00, Fri 13:00–21:00, Sat 13:00–20:00; Sun & Mon closed
export const BUSINESS_HOURS = {
  0: null,
  1: null,
  2: { open: 12, close: 20 },
  3: { open: 12, close: 20 },
  4: { open: 12, close: 20 },
  5: { open: 13, close: 21 },
  6: { open: 13, close: 20 },
};

// Validate delivery window string "YYYY-MM-DDTHH:MM" against business hours + 60-min prep floor
export function validateWindow(windowId, now = new Date()) {
  if (!windowId || typeof windowId !== "string") return false;
  const parts = windowId.split("T");
  if (parts.length !== 2) return false;
  const [dateStr, timeStr] = parts;
  const [hStr, mStr] = timeStr.split(":");
  const hour = Number(hStr);
  const minute = Number(mStr);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return false;

  const targetDate = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
  if (Number.isNaN(targetDate.getTime())) return false;

  // 60-min prep floor check
  if (targetDate.getTime() < now.getTime() + 55 * 60 * 1000) {
    return false;
  }

  const day = targetDate.getDay();
  const hours = BUSINESS_HOURS[day];
  if (!hours) return false;

  if (hour < hours.open || hour >= hours.close) {
    return false;
  }
  return true;
}

// Validate + price a client cart server-side. Throws on bad input.
// Returns { items:[{id,qty,name,priceCents}], totalCents }.
export function priceCart(items) {
  if (!Array.isArray(items) || items.length === 0) {
    const e = new Error("Cart is empty."); e.code = 400; throw e;
  }
  const out = [];
  let totalCents = 0;
  for (const raw of items) {
    const id = String(raw.id || "");
    const qty = Math.floor(Number(raw.qty));
    const priceCents = PRICES_CENTS[id];
    if (priceCents == null) { const e = new Error(`Unknown item: ${id}`); e.code = 400; throw e; }
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) { const e = new Error(`Bad quantity for ${id}`); e.code = 400; throw e; }
    out.push({ id, qty, name: NAMES[id], priceCents });
    totalCents += priceCents * qty;
  }
  return { items: out, totalCents };
}

// Unguessable order id for the public /order/:id link.
export function newOrderId() {
  // 4-char human short code is derived on the client for display; the real id is long.
  const rand = () => Math.random().toString(36).slice(2);
  return `ord_${Date.now().toString(36)}${rand()}${rand()}`.slice(0, 32);
}

export const nowIso = () => new Date().toISOString();
