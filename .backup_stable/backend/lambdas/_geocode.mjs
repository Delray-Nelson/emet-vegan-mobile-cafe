// Amazon Location Service Geocoding helper (AWS SDK v3 in Lambda runtime)
import { LocationClient, SearchPlaceIndexForTextCommand } from "@aws-sdk/client-location";

const REGION = process.env.AWS_REGION || "us-east-1";
const PLACE_INDEX = process.env.AWS_LOCATION_PLACE_INDEX || "emet-place-index";

let client = null;
function getClient() {
  if (!client) {
    client = new LocationClient({ region: REGION });
  }
  return client;
}

/**
 * Geocode a physical street address + ZIP to [longitude, latitude]
 * Returns [lng, lat] or null if not found
 */
export async function geocode(addressText) {
  if (!addressText || !addressText.trim()) return null;
  try {
    const loc = getClient();
    const cmd = new SearchPlaceIndexForTextCommand({
      IndexName: PLACE_INDEX,
      Text: addressText.trim(),
      MaxResults: 1,
    });
    const res = await loc.send(cmd);
    const point = res.Results?.[0]?.Place?.Geometry?.Point;
    if (Array.isArray(point) && point.length === 2) {
      return point; // [lng, lat]
    }
  } catch (err) {
    console.warn("Geocoding failed for address:", addressText, err.message);
  }
  return null;
}
