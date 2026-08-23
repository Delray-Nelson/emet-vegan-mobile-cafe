// POST /orders/{id}/status (staff) — owner advances an order.
// Enforces the legal forward path, is idempotent (re-tapping the same target is a
// no-op success), and stamps a per-stage timestamp. The SMS is NOT sent here —
// the DynamoDB Stream trigger (notifyOnStatus) fires texts on accepted & ready.
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { doc, ORDERS_TABLE, json, preflight, isStaff, nowIso } from "./_lib.mjs";

// allowed transitions (forward only)
const NEXT = {
  accepted: ["being_made"],
  being_made: ["ready"],
  ready: ["picked_up"],
};
const STAMP = { being_made: "startedAt", ready: "readyAt", picked_up: "pickedUpAt" };

export const handler = async (event) => {
  const pre = preflight(event); if (pre) return pre;
  if (!isStaff(event)) return json(401, { error: "Unauthorized." });

  const id = event.pathParameters?.id;
  let target;
  try { target = JSON.parse(event.body || "{}").status; } catch { target = null; }
  if (!id || !target) return json(400, { error: "Missing order id or status." });

  const stampAttr = STAMP[target] || "updatedAt";
  try {
    const res = await doc.send(new UpdateCommand({
      TableName: ORDERS_TABLE,
      Key: { orderId: id },
      UpdateExpression: `SET #s = :t, ${stampAttr} = :now`,
      // idempotent + legal-transition guard: allow if already at target, or if
      // current status legally precedes it. (contains() over a 1-2 item list)
      ConditionExpression:
        "attribute_exists(orderId) AND (#s = :t OR " +
        "(#s = :accepted AND :t = :being_made) OR " +
        "(#s = :being_made AND :t = :ready) OR " +
        "(#s = :ready AND :t = :picked_up))",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":t": target,
        ":now": nowIso(),
        ":accepted": "accepted",
        ":being_made": "being_made",
        ":ready": "ready",
        ":picked_up": "picked_up",
      },
      ReturnValues: "ALL_NEW",
    }));
    return json(200, { order: { orderId: id, status: res.Attributes.status } });
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException")
      return json(409, { error: "That status change isn’t allowed from the order’s current state." });
    console.error("updateOrderStatus", e);
    return json(500, { error: "Could not update order." });
  }
};
