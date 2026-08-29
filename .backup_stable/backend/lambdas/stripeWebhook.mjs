// POST /stripe-webhook (Stripe signature auth) — the moment of truth.
// Verifies the signature against the RAW body (decoding base64 if API Gateway
// set isBase64Encoded; never JSON.parse first), then on checkout.session.completed
// flips the order to paymentStatus=paid, status=accepted. Idempotent: only the
// first paid event advances the order, so retries/replays are safe. This is what
// makes the order appear for staff and fires the "accepted" text (via the Stream).
import Stripe from "stripe";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { doc, ORDERS_TABLE, rawBody, corsHeaders, nowIso } from "./_lib.mjs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

export const handler = async (event) => {
  const sig = event.headers?.["stripe-signature"] || event.headers?.["Stripe-Signature"];
  const payload = rawBody(event); // RAW, undecoded JSON string

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(payload, sig, WEBHOOK_SECRET);
  } catch (e) {
    console.error("Webhook signature verification failed:", e.message);
    return { statusCode: 400, headers: corsHeaders(), body: `Webhook Error: ${e.message}` };
  }

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const orderId = session.client_reference_id || session.metadata?.orderId;
    if (orderId) {
      try {
        await doc.send(new UpdateCommand({
          TableName: ORDERS_TABLE,
          Key: { orderId },
          UpdateExpression: "SET #s = :accepted, paymentStatus = :paid, acceptedAt = :now",
          // idempotent: only advance an order still awaiting payment
          ConditionExpression: "#s = :pending",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":accepted": "accepted",
            ":paid": "paid",
            ":pending": "pending_payment",
            ":now": nowIso(),
          },
        }));
      } catch (e) {
        if (e.name !== "ConditionalCheckFailedException") {
          console.error("stripeWebhook update", e);
          return { statusCode: 500, headers: corsHeaders(), body: "update failed" };
        }
        // already processed — treat as success (idempotent)
      }
    }
  }

  return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ received: true }) };
};
