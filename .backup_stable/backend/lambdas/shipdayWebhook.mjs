// POST /shipday-webhook (Shipday status callback)
// Token-validated webhook to advance tracking when courier updates delivery state

import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { doc, json, parseBody, ORDERS_TABLE, nowIso } from "./_lib.mjs";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return json(204, "");
  }

  // Token validation
  const token = event.queryStringParameters?.token || event.headers?.["x-shipday-token"] || "";
  const expected = process.env.SHIPDAY_WEBHOOK_TOKEN;
  if (expected && token !== expected) {
    return json(401, { error: "Invalid webhook token." });
  }

  const payload = parseBody(event);
  const orderNumber = payload.orderNumber || payload.order_number;
  const status = payload.status || payload.event;

  if (!orderNumber) {
    return json(400, { error: "Missing orderNumber in webhook payload." });
  }

  // Map Shipday status to our tracking status
  // e.g. "STARTED" / "ONTHEWAY" -> "out_for_delivery", "COMPLETED" / "DELIVERED" -> "delivered"
  let mappedStatus = null;
  const upper = String(status).toUpperCase();
  if (["STARTED", "ONTHEWAY", "ON_THE_WAY", "PICKEDUP", "PICKED_UP"].some((s) => upper.includes(s))) {
    mappedStatus = "out_for_delivery";
  } else if (["COMPLETED", "DELIVERED", "DROPPED_OFF"].some((s) => upper.includes(s))) {
    mappedStatus = "delivered";
  }

  if (mappedStatus) {
    try {
      await doc.send(new UpdateCommand({
        TableName: ORDERS_TABLE,
        Key: { orderId: orderNumber },
        UpdateExpression: "SET #st = :st, updatedAt = :u" + (mappedStatus === "delivered" ? ", deliveredAt = :d" : ""),
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":st": mappedStatus,
          ":u": nowIso(),
          ...(mappedStatus === "delivered" ? { ":d": nowIso() } : {}),
        },
      }));
    } catch (e) {
      console.warn("Failed to update status from Shipday webhook:", e.message);
    }
  }

  return json(200, { received: true, mappedStatus });
}
