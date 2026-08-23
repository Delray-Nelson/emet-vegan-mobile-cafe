// GET /slots (public) — returns pickup windows for the checkout picker.
// Reads emet_slots; each row: { slotId, date, time, capacity, booked }.
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { doc, SLOTS_TABLE, json, preflight } from "./_lib.mjs";

export const handler = async (event) => {
  const pre = preflight(event); if (pre) return pre;
  try {
    const { Items = [] } = await doc.send(new ScanCommand({ TableName: SLOTS_TABLE }));
    // Only surface future, non-full windows; keep it lean for the client.
    const now = Date.now();
    const slots = Items
      .map((s) => ({
        slotId: s.slotId,
        date: s.date || String(s.slotId).split("T")[0],
        time: s.time || null,
        capacity: Number(s.capacity ?? 0),
        booked: Number(s.booked ?? 0),
        soldOut: Number(s.booked ?? 0) >= Number(s.capacity ?? 0),
      }))
      .filter((s) => {
        const t = Date.parse(s.slotId);
        return Number.isNaN(t) ? true : t > now - 5 * 60 * 1000; // small grace
      })
      .sort((a, b) => String(a.slotId).localeCompare(String(b.slotId)));
    return json(200, { slots });
  } catch (e) {
    console.error("getSlots", e);
    return json(500, { error: "Could not load slots." });
  }
};
