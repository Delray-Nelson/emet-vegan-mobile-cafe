// Delivery pricing & service area configuration
// Full 15-20 Mile Delivery Radius around EMET Kitchen (214 Aster Ave, Locust Grove GA 30248)
// ZIP codes and standard delivery fees in integer cents

export const DELIVERY_FEES_CENTS = {
  // 0 – 5 Miles (Immediate Locust Grove area)
  "30248": 1000, // Locust Grove ($10.00)
  "30234": 1200, // Jenkinsburg (~6 miles - $12.00)
  
  // 5 – 12 Miles (McDonough & Jackson)
  "30252": 1200, // McDonough East (~8 miles - $12.00)
  "30253": 1400, // McDonough West (~10 miles - $14.00)
  "30233": 1400, // Jackson (~12 miles - $14.00)

  // 12 – 20 Miles (Henry, Spalding, Clayton borders)
  "30228": 1500, // Hampton (~14 miles - $15.00)
  "30250": 1500, // Lovejoy (~14 miles - $15.00)
  "30223": 1500, // Griffin East (~15 miles - $15.00)
  "30224": 1600, // Griffin West (~18 miles - $16.00)
  "30281": 1600, // Stockbridge (~17 miles - $16.00)
  "30236": 1600, // Jonesboro South (~18 miles - $16.00)
};

export const SERVICED_ZIPS = Object.keys(DELIVERY_FEES_CENTS);

export function getDeliveryFeeCents(zip) {
  if (!zip) return null;
  const cleanZip = String(zip).trim().slice(0, 5);
  return DELIVERY_FEES_CENTS[cleanZip] ?? null;
}

export function isZipServiced(zip) {
  return getDeliveryFeeCents(zip) !== null;
}

/**
 * Calculates complete order financials:
 * - Food Subtotal
 * - 18% Gratuity
 * - 7% Sales Tax
 * - Delivery Fee based on ZIP
 * - All fees and taxes apply to all orders regardless of order price.
 */
export function calculateOrderBreakdown(subtotalCents, zip) {
  const sub = Math.max(0, subtotalCents || 0);
  const gratuityCents = Math.round(sub * 0.18); // 18% gratuity
  const rawTaxCents = Math.round(sub * 0.07); // 7% standard tax
  const baseDeliveryFeeCents = getDeliveryFeeCents(zip);

  const taxCents = rawTaxCents;
  const deliveryFeeCents = baseDeliveryFeeCents || 0;
  const grandTotalCents = sub + gratuityCents + taxCents + deliveryFeeCents;

  return {
    subtotalCents: sub,
    gratuityCents,
    rawTaxCents,
    taxCents,
    baseDeliveryFeeCents,
    deliveryFeeCents,
    grandTotalCents,
    isPromoEligible: false,
    remainingForPromoCents: 0,
    savingsCents: 0,
  };
}

// Business operating hours (America/New_York)
// Tue–Thu 12:00–20:00 (12 PM – 8 PM)
// Fri 13:00–21:00 (1 PM – 9 PM)
// Sat 13:00–20:00 (1 PM – 8 PM)
// Sun & Mon: Closed
export const BUSINESS_HOURS = {
  0: null, // Sun - Closed
  1: null, // Mon - Closed
  2: { open: 12, close: 20 }, // Tue
  3: { open: 12, close: 20 }, // Wed
  4: { open: 12, close: 20 }, // Thu
  5: { open: 13, close: 21 }, // Fri
  6: { open: 13, close: 20 }, // Sat
};

// Generate available 30-minute delivery windows for today and next active day
// Enforces mandatory 60-minute prep floor
export function generateDeliveryWindows(now = new Date()) {
  const windows = [];
  const prepFloorMs = 60 * 60 * 1000; // 60 minutes

  for (let dayOffset = 0; dayOffset <= 4; dayOffset++) {
    const targetDate = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const dayOfWeek = targetDate.getDay();
    const hours = BUSINESS_HOURS[dayOfWeek];
    if (!hours) continue; // Closed day

    const dateStr = targetDate.toISOString().slice(0, 10);
    const dayName = dayOffset === 0 ? "Today" : dayOffset === 1 ? "Tomorrow" : targetDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const times = [];

    for (let h = hours.open; h < hours.close; h++) {
      for (const m of [0, 30]) {
        const slotDate = new Date(targetDate);
        slotDate.setHours(h, m, 0, 0);

        // Check 60-minute prep floor
        if (slotDate.getTime() >= now.getTime() + prepFloorMs) {
          const hStr = String(h).padStart(2, "0");
          const mStr = String(m).padStart(2, "0");
          const windowId = `${dateStr}T${hStr}:${mStr}`;
          const hr12 = ((h + 11) % 12) + 1;
          const ampm = h < 12 ? "AM" : "PM";
          const timeFormatted = `${hr12}:${mStr} ${ampm}`;

          times.push({
            windowId,
            time: timeFormatted,
            soldOut: false,
          });
        }
      }
    }

    if (times.length > 0) {
      windows.push({
        date: dateStr,
        label: `${dayName} (${targetDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`,
        times,
      });
    }

    if (windows.length >= 2) break;
  }

  return windows;
}
