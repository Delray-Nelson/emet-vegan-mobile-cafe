// POST /orders/{id}/dispatch (Staff-authorized)
// Handles Post-Payment Dispatch (Shipday courier or Owner self-delivery)
// Bundles _lib.mjs + _shipday.mjs + _geocode.mjs (uses Node 20 global fetch + in-runtime AWS SDK)

import { UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { doc, json, parseBody, isStaff, ORDERS_TABLE, nowIso } from "./_lib.mjs";
import { insertShipdayOrder } from "./_shipday.mjs";
import { geocode } from "./_geocode.mjs";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return json(204, "");
  }

  if (!isStaff(event)) {
    return json(401, { error: "Unauthorized staff token." });
  }

  const orderId = event.pathParameters?.id;
  if (!orderId) {
    return json(400, { error: "Missing order id." });
  }

  const body = parseBody(event);
  const dispatchType = body.dispatchType || "shipday"; // "shipday" | "self"

  // 1. Fetch current order
  const getRes = await doc.send(new GetCommand({
    TableName: ORDERS_TABLE,
    Key: { orderId },
  }));
  const order = getRes.Item;
  if (!order) {
    return json(404, { error: "Order not found." });
  }

  if (order.paymentStatus !== "paid") {
    return json(400, { error: "Cannot dispatch unpaid order." });
  }

  let courierInfo = null;

  if (dispatchType === "shipday") {
    const apiKey = process.env.SHIPDAY_API_KEY;
    if (!apiKey) {
      return json(500, { error: "SHIPDAY_API_KEY environment variable is not configured." });
    }

    const fullAddress = `${order.deliveryAddress || ""}, ${order.deliveryCity || ""} GA ${order.deliveryZip || ""}`;
    const coords = await geocode(fullAddress);

    const shipdayRes = await insertShipdayOrder({
      apiKey,
      orderNumber: orderId,
      customerName: order.customerName,
      customerAddress: fullAddress,
      customerPhoneNumber: order.customerPhone,
      pickupAddress: process.env.EMET_KITCHEN_ADDRESS,
      pickupPhoneNumber: process.env.EMET_KITCHEN_PHONE,
      orderItem: (order.items || []).map((i) => ({ name: i.name, unitPrice: (i.priceCents || 0) / 100, quantity: i.qty })),
      totalAmount: (order.totalCents || 0) / 100,
      deliveryInstruction: order.deliveryInstructions || "",
      expectedDeliveryDate: order.deliveryDate || "",
      expectedDeliveryTime: order.deliveryWindow || "",
    });

    courierInfo = {
      type: "shipday",
      shipdayOrderId: shipdayRes.orderId || shipdayRes.id || null,
      dispatchedAt: nowIso(),
    };
  } else {
    courierInfo = {
      type: "self",
      dispatchedAt: nowIso(),
    };
  }

  // Update DynamoDB order state to out_for_delivery
  const updated = await doc.send(new UpdateCommand({
    TableName: ORDERS_TABLE,
    Key: { orderId },
    UpdateExpression: "SET #st = :st, courierInfo = :cinfo, updatedAt = :u, outForDeliveryAt = :ofd",
    ExpressionAttributeNames: { "#st": "status" },
    ExpressionAttributeValues: {
      ":st": "out_for_delivery",
      ":cinfo": courierInfo,
      ":u": nowIso(),
      ":ofd": nowIso(),
    },
    ReturnValues: "ALL_NEW",
  }));

  return json(200, { order: updated.Attributes });
}
