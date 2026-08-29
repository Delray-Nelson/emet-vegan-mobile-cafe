// GET /orders/{id} (public; the id is long + unguessable) — feeds the tracker.
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { doc, ORDERS_TABLE, json, preflight } from "./_lib.mjs";

export const handler = async (event) => {
  const pre = preflight(event); if (pre) return pre;
  const id = event.pathParameters?.id;
  if (!id) return json(400, { error: "Missing order id." });
  try {
    const { Item } = await doc.send(new GetCommand({ TableName: ORDERS_TABLE, Key: { orderId: id } }));
    if (!Item) return json(404, { error: "Order not found." });
    // return only what the tracker needs (no phone/payment internals)
    return json(200, {
      orderId: Item.orderId,
      status: Item.status,
      items: Item.items || [],
      slotTime: Item.slotTime || null,
      createdAt: Item.createdAt,
    });
  } catch (e) {
    console.error("getOrder", e);
    return json(500, { error: "Could not load order." });
  }
};
