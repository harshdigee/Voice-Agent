// makeOutboundCall.js
import dotenv from "dotenv";
import path from "path";
import twilio from "twilio";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_FROM_NUMBER;
const toNumber = process.env.OUTBOUND_TO_NUMBER;
const twimlUrl = `${process.env.PUBLIC_BASE_URL}/voice/inbound`;

if (!accountSid || !authToken || !fromNumber || !toNumber || !process.env.PUBLIC_BASE_URL) {
  console.error(
    "Missing env vars. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, OUTBOUND_TO_NUMBER, and PUBLIC_BASE_URL in .env"
  );
  process.exit(1);
}

const client = twilio(accountSid, authToken);

async function makeCall() {
  try {
    const call = await client.calls.create({
      from: fromNumber,
      to: toNumber,
      url: twimlUrl,
    });

    console.log("Outbound call initiated successfully!");
    console.log("Call SID:", call.sid);
    console.log("Status:", call.status);
  } catch (error) {
    console.error("Error placing call:", error.message);
  }
}

makeCall();
