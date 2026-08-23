// DynamoDB Stream trigger on emet_orders (NEW_AND_OLD_IMAGES). Sends the customer
// an SMS via SNS when the status CHANGES to `accepted` or `ready` only (the two
// moments worth a ping). Idempotent by nature: fires only on the transition edge,
// not on every write. Set the SNS SMS type to Transactional.
//
// Until A2P 10DLC registration clears, SNS may not deliver to unverified numbers —
// in-app tracking still works, and no code changes when registration completes.
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const sns = new SNSClient({ region: process.env.AWS_REGION || "us-east-1" });

const MESSAGES = {
  accepted: (o) => `EMET Vegan Cafe: order #${short(o.orderId)} accepted — we’ve got your payment. Track it: ${site()}/order/${o.orderId}`,
  ready: (o) => `EMET Vegan Cafe: order #${short(o.orderId)} is READY for pickup. Come grab it at the counter! 🌿`,
};
const short = (v = "") => String(v).replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase();
const site = () => process.env.SITE_URL || "https://emet-vegan.shop";

export const handler = async (event) => {
  for (const rec of event.Records || []) {
    if (rec.eventName !== "MODIFY" && rec.eventName !== "INSERT") continue;
    const oldImg = rec.dynamodb?.OldImage ? unmarshall(rec.dynamodb.OldImage) : {};
    const newImg = rec.dynamodb?.NewImage ? unmarshall(rec.dynamodb.NewImage) : {};
    const from = oldImg.status;
    const to = newImg.status;
    if (!to || from === to) continue;                 // only on a real status change
    if (to !== "accepted" && to !== "ready") continue; // texts only on these two
    const phone = newImg.customerPhone;
    if (!phone) continue;

    const msg = MESSAGES[to](newImg);
    try {
      await sns.send(new PublishCommand({
        PhoneNumber: normalize(phone),
        Message: msg,
        MessageAttributes: {
          "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" },
        },
      }));
    } catch (e) {
      console.error("notifyOnStatus publish failed", { to, orderId: newImg.orderId, err: e.message });
      // swallow — a failed text must not fail the stream batch / block tracking
    }
  }
  return { ok: true };
};

// naive E.164 normalization for US numbers; adjust if you serve other regions.
function normalize(p) {
  const d = String(p).replace(/[^\d]/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return p.startsWith("+") ? p : `+${d}`;
}
