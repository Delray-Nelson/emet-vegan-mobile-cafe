// Shipday API Integration Helper
// Handles Order insertion & on-demand courier dispatch via Node 20 global fetch

const SHIPDAY_BASE = "https://api.shipday.com";

export async function insertShipdayOrder({
  apiKey,
  orderNumber,
  customerName,
  customerAddress,
  customerPhoneNumber,
  customerEmail,
  pickupAddress,
  pickupPhoneNumber,
  orderItems,
  orderItem,
  totalAmount,
  deliveryInstruction,
  expectedDeliveryDate,
  expectedDeliveryTime,
}) {
  if (!apiKey) throw new Error("SHIPDAY_API_KEY is not configured.");

  const cleanKey = apiKey.trim().replace(/^Basic\s+/i, "");
  const items = Array.isArray(orderItems)
    ? orderItems
    : Array.isArray(orderItem)
    ? orderItem
    : [];

  const payload = {
    orderNumber: String(orderNumber),
    customerName: customerName || "Valued Customer",
    customerAddress: customerAddress,
    customerPhoneNumber: customerPhoneNumber ? String(customerPhoneNumber).replace(/\D/g, "") : "",
    customerEmail: customerEmail || "",
    restaurantName: "EMET Vegan Cafe",
    restaurantAddress: pickupAddress || process.env.EMET_KITCHEN_ADDRESS || "214 Aster Ave, Locust Grove GA 30248",
    restaurantPhoneNumber: pickupPhoneNumber || process.env.EMET_KITCHEN_PHONE || "4049410711",
    orderItems: items.map((i) => ({
      name: String(i.name || "Menu Item"),
      unitPrice: typeof i.unitPrice === "number" ? i.unitPrice : parseFloat(i.unitPrice || i.price || "0"),
      quantity: parseInt(i.quantity || i.qty || 1, 10),
    })),
    totalOrderCost: typeof totalAmount === "number" ? Number(totalAmount.toFixed(2)) : 0,
    deliveryInstruction: deliveryInstruction || "",
  };

  if (expectedDeliveryDate) payload.expectedDeliveryDate = expectedDeliveryDate;
  if (expectedDeliveryTime) payload.expectedDeliveryTime = expectedDeliveryTime;

  const response = await fetch(`${SHIPDAY_BASE}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${cleanKey}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMsg = body.message || body.error || `Shipday error HTTP ${response.status}`;
    throw new Error(errorMsg);
  }

  return body;
}

export async function assignShipdayCourier({ apiKey, orderId, carrierId }) {
  if (!apiKey) throw new Error("SHIPDAY_API_KEY is not configured.");

  const response = await fetch(`${SHIPDAY_BASE}/orders/assign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `basic ${apiKey}`,
    },
    body: JSON.stringify({ orderId, carrierId }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || "Failed to assign carrier.");
  }
  return body;
}

/**
 * Fetch real-time delivery fee estimate from Shipday (or return null if not configured / unavailable).
 * Shipday supports on-demand third-party delivery quotes (DoorDash Drive, Uber Direct) or mileage rates.
 */
export async function getShipdayDeliveryFeeEstimate({ apiKey, customerAddress, pickupAddress }) {
  if (!apiKey) return null;
  try {
    const res = await fetch(`${SHIPDAY_BASE}/order/delivery-fee`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `basic ${apiKey}`,
      },
      body: JSON.stringify({
        pickupAddress: pickupAddress || process.env.EMET_KITCHEN_ADDRESS || "Locust Grove, GA 30248",
        deliveryAddress: customerAddress,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (data && typeof data.fee === "number") {
      return Math.round(data.fee * 100); // Return in integer cents
    }
    return null;
  } catch (err) {
    console.warn("Shipday fee estimation error (falling back to static ZIP rates):", err.message);
    return null;
  }
}
