// POST /checkout-session (public) — validate delivery address + ZIP + fee + window SERVER-SIDE,
// write a pending order, then create a Stripe Checkout Session with food items + Delivery fee line item.
//
// The order does NOT become visible to staff here — only the paid webhook flips
// it to accepted. This prevents abandoned checkouts from showing as ghost orders.
import Stripe from "stripe";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  doc, ORDERS_TABLE, json, preflight, parseBody,
  priceCart, newOrderId, nowIso, getDeliveryFeeCents, validateWindow,
} from "./_lib.mjs";
import { getShipdayDeliveryFeeEstimate } from "./_shipday.mjs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SITE = process.env.SITE_URL || "https://emet-vegan.shop";

export const handler = async (event) => {
  const pre = preflight(event); if (pre) return pre;
  try {
    const body = parseBody(event);
    const { windowId, customer, delivery } = body;

    // 1) Price the cart server-side (never trust client amounts)
    let priced;
    try { priced = priceCart(body.items); }
    catch (e) { return json(e.code || 400, { error: e.message }); }

    // 2) Validate delivery address & ZIP
    const zip = String(delivery?.zip || "").trim();
    const address = String(delivery?.address || "").trim();
    const city = String(delivery?.city || "").trim();
    if (!address || !zip) {
      return json(400, { error: "Delivery address and ZIP code are required." });
    }

    let deliveryFeeCents = getDeliveryFeeCents(zip);
    if (deliveryFeeCents === null) {
      return json(422, { error: `Delivery is not currently available to ZIP code ${zip}.` });
    }

    // If Shipday API is configured, attempt real-time rate query from Shipday
    if (process.env.SHIPDAY_API_KEY) {
      const fullAddress = `${address}, ${city || "Locust Grove"} GA ${zip}`;
      const shipdayFee = await getShipdayDeliveryFeeEstimate({
        apiKey: process.env.SHIPDAY_API_KEY,
        customerAddress: fullAddress,
        pickupAddress: process.env.EMET_KITCHEN_ADDRESS,
      });
      if (typeof shipdayFee === "number" && shipdayFee > 0) {
        deliveryFeeCents = shipdayFee;
      }
    }

    // 3) Validate delivery window (business hours + 60-min prep floor)
    if (!windowId || !validateWindow(windowId)) {
      return json(409, { error: "Selected delivery window is outside operating hours or violates the 60-minute prep floor." });
    }

    if (!customer?.name || !customer?.phone) {
      return json(400, { error: "Name and mobile number are required." });
    }

    // 4) Compute exact order financials & $40+ promotion waiver
    const baseDeliveryFeeCents = deliveryFeeCents;
    const subtotalCents = priced.totalCents;
    const gratuityCents = Math.round(subtotalCents * 0.18); // 18% gratuity
    const rawTaxCents = Math.round(subtotalCents * 0.07); // 7% sales tax

    // If (subtotal + gratuity + taxes) >= $40.00 (4000 cents), waive delivery and taxes
    const qualifyingTotal = subtotalCents + gratuityCents + rawTaxCents;
    const isPromoEligible = qualifyingTotal >= 4000;

    const finalTaxCents = isPromoEligible ? 0 : rawTaxCents;
    const finalDeliveryFeeCents = isPromoEligible ? 0 : baseDeliveryFeeCents;
    const grandTotalCents = subtotalCents + gratuityCents + finalTaxCents + finalDeliveryFeeCents;

    const orderId = newOrderId();
    const createdAt = nowIso();

    const order = {
      orderId,
      status: "pending_payment",
      paymentStatus: "pending",
      items: priced.items.map((i) => ({ id: i.id, qty: i.qty, name: i.name, priceCents: i.priceCents })),
      subtotalCents,
      gratuityCents,
      taxCents: finalTaxCents,
      rawTaxCents,
      deliveryFeeCents: finalDeliveryFeeCents,
      baseDeliveryFeeCents,
      totalCents: grandTotalCents,
      isPromoWaived: isPromoEligible,
      deliveryWindow: windowId,
      deliveryDate: windowId.split("T")[0],
      deliveryAddress: address,
      deliveryCity: city || "Locust Grove",
      deliveryZip: zip,
      deliveryInstructions: delivery?.instructions || "",
      customerName: customer.name.trim(),
      customerPhone: customer.phone.trim(),
      createdAt,
    };
    await doc.send(new PutCommand({ TableName: ORDERS_TABLE, Item: order }));

    // 5) Create the Stripe Checkout Session (amounts in integer cents)
    // Line items include food items + 18% gratuity + tax (if applicable) + delivery fee (if applicable)
    const lineItems = priced.items.map((i) => ({
      quantity: i.qty,
      price_data: {
        currency: "usd",
        unit_amount: i.priceCents,
        product_data: { name: i.name },
      },
    }));

    // 18% Staff Kitchen Gratuity
    if (gratuityCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: gratuityCents,
          product_data: {
            name: "18% Staff Kitchen Gratuity",
            description: "Directly distributed to EMET culinary prep and courier staff",
          },
        },
      });
    }

    // Sales Tax (if not waived)
    if (finalTaxCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: finalTaxCents,
          product_data: { name: "Sales Tax (GA 7%)" },
        },
      });
    }

    // Delivery Fee (if not waived)
    if (finalDeliveryFeeCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: finalDeliveryFeeCents,
          product_data: { name: `Delivery Fee (${zip})` },
        },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      client_reference_id: orderId,
      metadata: {
        orderId,
        zip,
        windowId,
        promoWaived: isPromoEligible ? "true" : "false",
      },
      success_url: `${SITE}/order/${orderId}`,
      cancel_url: `${SITE}/checkout`,
    });

    return json(200, { url: session.url, orderId });
  } catch (e) {
    console.error("createCheckoutSession", e);
    return json(500, { error: "Could not start checkout." });
  }
};
