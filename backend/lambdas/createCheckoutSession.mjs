// POST /checkout-session (public) — validate slot + price SERVER-SIDE, write a
// pending order, reserve the slot atomically (reject full with 409), then create
// a Stripe Checkout Session and return its URL.
//
// The order does NOT become visible to staff here — only the paid webhook flips
// it to accepted. This prevents abandoned checkouts from showing as ghost orders.
import Stripe from "stripe";
import { PutCommand, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  doc, ORDERS_TABLE, SLOTS_TABLE, json, preflight, parseBody,
  priceCart, newOrderId, nowIso,
} from "./_lib.mjs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SITE = process.env.SITE_URL || "https://emet-vegan.shop";

export const handler = async (event) => {
  const pre = preflight(event); if (pre) return pre;
  try {
    const body = parseBody(event);
    const { slotId, customer } = body;

    // 1) price the cart server-side (never trust client amounts)
    let priced;
    try { priced = priceCart(body.items); }
    catch (e) { return json(e.code || 400, { error: e.message }); }

    if (!slotId) return json(400, { error: "Pick a pickup time." });
    if (!customer?.name || !customer?.phone) return json(400, { error: "Name and mobile number are required." });

    // 2) reserve the slot atomically — reject if full (409) or missing (400)
    const slotRes = await doc.send(new GetCommand({ TableName: SLOTS_TABLE, Key: { slotId } }));
    if (!slotRes.Item) return json(400, { error: "That pickup time is no longer available." });
    try {
      await doc.send(new UpdateCommand({
        TableName: SLOTS_TABLE,
        Key: { slotId },
        UpdateExpression: "SET booked = if_not_exists(booked, :z) + :one",
        ConditionExpression: "attribute_not_exists(booked) OR booked < capacity",
        ExpressionAttributeValues: { ":one": 1, ":z": 0 },
      }));
    } catch (e) {
      if (e.name === "ConditionalCheckFailedException") return json(409, { error: "That pickup time just filled up." });
      throw e;
    }

    // 3) write the pending order
    const orderId = newOrderId();
    const createdAt = nowIso();
    const order = {
      orderId,
      status: "pending_payment",
      paymentStatus: "pending",
      items: priced.items.map((i) => ({ id: i.id, qty: i.qty })),
      totalCents: priced.totalCents,
      slotId,
      slotTime: slotRes.Item.time || null,
      customerName: customer.name,
      customerPhone: customer.phone,
      createdAt,
    };
    await doc.send(new PutCommand({ TableName: ORDERS_TABLE, Item: order }));

    // 4) create the Stripe Checkout Session (amounts in integer cents)
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: priced.items.map((i) => ({
        quantity: i.qty,
        price_data: {
          currency: "usd",
          unit_amount: i.priceCents,
          product_data: { name: i.name },
        },
      })),
      client_reference_id: orderId,
      metadata: { orderId, slotId },
      success_url: `${SITE}/order/${orderId}`,
      cancel_url: `${SITE}/checkout`,
      // Stripe emails the receipt when email receipts are enabled in the dashboard.
    });

    return json(200, { url: session.url, orderId });
  } catch (e) {
    console.error("createCheckoutSession", e);
    return json(500, { error: "Could not start checkout." });
  }
};
