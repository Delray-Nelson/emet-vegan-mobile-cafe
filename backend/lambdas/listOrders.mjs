// GET /orders (staff) — active PAID orders for the dashboard.
// Queries the status-createdAt-index for each active status, with automatic
// fallback to Scan if index is not provisioned. Returns active delivery orders.
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { doc, ORDERS_TABLE, json, preflight, isStaff } from "./_lib.mjs";

const ACTIVE = ["accepted", "being_made", "ready", "out_for_delivery"];

export const handler = async (event) => {
  const pre = preflight(event); if (pre) return pre;
  if (!isStaff(event)) return json(401, { error: "Unauthorized." }, event);
  try {
    let orders = [];
    try {
      // 1. Try querying the GSI index
      const results = await Promise.all(
        ACTIVE.map((status) =>
          doc.send(new QueryCommand({
            TableName: ORDERS_TABLE,
            IndexName: "status-createdAt-index",
            KeyConditionExpression: "#s = :s",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: { ":s": status },
          }))
        )
      );
      orders = results.flatMap((r) => r.Items || []);
    } catch (queryErr) {
      // 2. Fallback to Scan if index does not exist
      console.warn("Index query fallback to Scan:", queryErr.message);
      const scanRes = await doc.send(new ScanCommand({
        TableName: ORDERS_TABLE,
        FilterExpression: "#s IN (:s1, :s2, :s3, :s4) OR (#s = :pending AND paymentStatus = :paid)",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":s1": "accepted",
          ":s2": "being_made",
          ":s3": "ready",
          ":s4": "out_for_delivery",
          ":pending": "pending_payment",
          ":paid": "paid",
        },
      }));
      orders = scanRes.Items || [];
    }

    const formatted = orders
      .map((o) => ({
        orderId: o.orderId,
        status: o.status === "pending_payment" && o.paymentStatus === "paid" ? "accepted" : o.status,
        paymentStatus: o.paymentStatus,
        items: o.items || [],
        customerName: o.customerName || "Customer",
        customerPhone: o.customerPhone || "",
        deliveryAddress: o.deliveryAddress || "",
        deliveryCity: o.deliveryCity || "Locust Grove",
        deliveryZip: o.deliveryZip || "",
        deliveryInstructions: o.deliveryInstructions || "",
        deliveryWindow: o.deliveryWindow || "",
        totalCents: o.totalCents || 0,
        subtotalCents: o.subtotalCents || 0,
        shipdayOrderId: o.shipdayOrderId || null,
        shipdayDispatchedAt: o.shipdayDispatchedAt || null,
        createdAt: o.createdAt,
      }))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

    return json(200, { orders: formatted }, event);
  } catch (e) {
    console.error("listOrders", e);
    return json(500, { error: "Could not load orders." }, event);
  }
};

