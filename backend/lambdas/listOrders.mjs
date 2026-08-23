// GET /orders (staff) — active PAID orders for the dashboard.
// Queries the status-createdAt-index for each active status so it never scans the
// whole table. Returns accepted + being_made + ready, oldest first.
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { doc, ORDERS_TABLE, json, preflight, isStaff } from "./_lib.mjs";

const ACTIVE = ["accepted", "being_made", "ready"];

export const handler = async (event) => {
  const pre = preflight(event); if (pre) return pre;
  if (!isStaff(event)) return json(401, { error: "Unauthorized." });
  try {
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
    const orders = results
      .flatMap((r) => r.Items || [])
      .map((o) => ({
        orderId: o.orderId,
        status: o.status,
        items: o.items || [],
        slotTime: o.slotTime || null,
        customerName: o.customerName || null,
        createdAt: o.createdAt,
      }))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return json(200, { orders });
  } catch (e) {
    console.error("listOrders", e);
    return json(500, { error: "Could not load orders." });
  }
};
