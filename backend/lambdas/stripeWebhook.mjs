// POST /stripe-webhook (Stripe signature auth) — the moment of truth.
// Verifies the signature against the RAW body (decoding base64 if API Gateway
// set isBase64Encoded; never JSON.parse first), then on checkout.session.completed
// flips the order to paymentStatus=paid, status=accepted. Idempotent: only the
// first paid event advances the order, so retries/replays are safe. This is what
// makes the order appear for staff and fires the "accepted" text (via the Stream).
// Automatically creates the delivery order in Shipday when SHIPDAY_API_KEY is configured.
import Stripe from "stripe";
import { UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { doc, ORDERS_TABLE, rawBody, corsHeaders, nowIso } from "./_lib.mjs";
import { insertShipdayOrder } from "./_shipday.mjs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

export const handler = async (event) => {
  const sig = event.headers?.["stripe-signature"] || event.headers?.["Stripe-Signature"];
  const payload = rawBody(event); // RAW, undecoded JSON string

  let stripeEvent;
  if (WEBHOOK_SECRET) {
    try {
      stripeEvent = stripe.webhooks.constructEvent(payload, sig, WEBHOOK_SECRET);
    } catch (e) {
      console.error("Webhook signature verification failed:", e.message);
      return { statusCode: 400, headers: corsHeaders(), body: `Webhook Error: ${e.message}` };
    }
  } else {
    // If webhook secret is not set, parse payload directly (useful during initial sandbox verification)
    try {
      stripeEvent = typeof payload === "string" ? JSON.parse(payload) : payload;
    } catch (e) {
      return { statusCode: 400, headers: corsHeaders(), body: "Invalid JSON payload" };
    }
  }

  if (stripeEvent?.type === "checkout.session.completed") {
    const session = stripeEvent.data?.object;
    const orderId = session?.client_reference_id || session?.metadata?.orderId;
    if (orderId) {
      try {
        // 1. Fetch current order from DynamoDB to ensure we have full customer & delivery address info
        let existingOrder = null;
        try {
          const getRes = await doc.send(new GetCommand({
            TableName: ORDERS_TABLE,
            Key: { orderId },
          }));
          existingOrder = getRes.Item;
        } catch (getErr) {
          console.warn("Could not get existing order before update:", getErr.message);
        }

        const updateRes = await doc.send(new UpdateCommand({
          TableName: ORDERS_TABLE,
          Key: { orderId },
          UpdateExpression: "SET #s = :accepted, paymentStatus = :paid, acceptedAt = :now, stripePaymentIntentId = :pi",
          ConditionExpression: "#s = :pending",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":accepted": "accepted",
            ":paid": "paid",
            ":pending": "pending_payment",
            ":now": nowIso(),
            ":pi": session.payment_intent || session.id || "",
          },
          ReturnValues: "ALL_NEW",
        }));

        const updatedOrder = updateRes.Attributes || existingOrder;

        // Auto-push to Shipday if Shipday key is configured and order exists
        const shipdayApiKey = process.env.SHIPDAY_API_KEY;
        if (shipdayApiKey && updatedOrder) {
          try {
            const fullAddress = updatedOrder.deliveryAddress
              ? `${updatedOrder.deliveryAddress}, ${updatedOrder.deliveryCity || "Locust Grove"} GA ${updatedOrder.deliveryZip || ""}`
              : (session.customer_details?.address?.line1
                  ? `${session.customer_details.address.line1}, ${session.customer_details.address.city || "Locust Grove"} GA ${session.customer_details.address.postal_code || ""}`
                  : "214 Aster Ave, Locust Grove GA 30248");

            const shipdayRes = await insertShipdayOrder({
              apiKey: shipdayApiKey,
              orderNumber: orderId,
              customerName: updatedOrder.customerName || session.customer_details?.name || "Customer",
              customerAddress: fullAddress,
              customerPhoneNumber: updatedOrder.customerPhone || session.customer_details?.phone || "",
              customerEmail: updatedOrder.customerEmail || session.customer_details?.email || "",
              pickupAddress: process.env.EMET_KITCHEN_ADDRESS || "214 Aster Ave, Locust Grove GA 30248",
              pickupPhoneNumber: process.env.EMET_KITCHEN_PHONE || "(404) 941-0711",
              orderItems: (updatedOrder.items || []).map((i) => ({
                name: i.name || "Menu Item",
                unitPrice: (i.priceCents || 0) / 100,
                quantity: i.qty || 1,
              })),
              totalAmount: (updatedOrder.totalCents || session.amount_total || 0) / 100,
              deliveryInstruction: updatedOrder.deliveryInstructions || updatedOrder.deliveryNotes || "",
            });

            if (shipdayRes && (shipdayRes.orderId || shipdayRes.id)) {
              const assignedShipdayId = String(shipdayRes.orderId || shipdayRes.id);
              await doc.send(new UpdateCommand({
                TableName: ORDERS_TABLE,
                Key: { orderId },
                UpdateExpression: "SET shipdayOrderId = :sId, shipdayDispatchedAt = :now",
                ExpressionAttributeValues: {
                  ":sId": assignedShipdayId,
                  ":now": nowIso(),
                },
              }));
              console.log(`Successfully created Shipday order ${assignedShipdayId} for order ${orderId}`);
            }
          } catch (shipErr) {
            console.error("Auto-Shipday insertion error (non-fatal):", shipErr);
          }
        }
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
