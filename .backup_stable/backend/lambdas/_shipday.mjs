// Shipday API Integration Helper
// Handles Order insertion & on-demand courier dispatch via Node 20 global fetch

const SHIPDAY_BASE = "https://api.shipday.com";

export async function insertShipdayOrder({
  apiKey,
  orderNumber,
  customerName,
  customerAddress,
  customerPhoneNumber,
  pickupAddress,
  pickupPhoneNumber,
  orderItem,
  totalAmount,
  deliveryInstruction,
  expectedDeliveryDate,
  expectedDeliveryTime,
}) {
  if (!apiKey) throw new Error("SHIPDAY_API_KEY is not configured.");

  const payload = {
    orderNumber: String(orderNumber),
    customerName: customerName || "Customer",
    customerAddress: customerAddress,
    customerPhoneNumber: customerPhoneNumber || "",
    customerEmail: "",
    restaurantName: "EMET Vegan Cafe",
    restaurantAddress: pickupAddress || process.env.EMET_KITCHEN_ADDRESS || "Locust Grove, GA 30248",
    restaurantPhoneNumber: pickupPhoneNumber || process.env.EMET_KITCHEN_PHONE || "(404) 555-0100",
    orderItem: Array.isArray(orderItem) ? orderItem : [],
    totalAmount: typeof totalAmount === "number" ? totalAmount : 0,
    deliveryInstruction: deliveryInstruction || "",
    expectedDeliveryDate: expectedDeliveryDate || "",
    expectedDeliveryTime: expectedDeliveryTime || "",
  };

  const response = await fetch(`${SHIPDAY_BASE}/orders/orderNumber/${encodeURIComponent(orderNumber)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `basic ${apiKey}`,
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
