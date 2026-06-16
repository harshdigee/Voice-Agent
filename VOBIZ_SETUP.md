# Vobiz Integration Setup

## Your Vobiz Credentials
```
Vobiz Number: +91 11 7366938
Auth ID: MA_8V9BUALX
Auth Token: GCFAmTWY2H7pLTnRXuyb5WP5tSDwWaqmtv076DYoXNR875RTeDXF1i8O1JlB5mh9
```

## Step 1: Add Vobiz credentials to `.env`

Add these lines to `.env`:
```env
VOBIZ_AUTH_ID=MA_8V9BUALX
VOBIZ_AUTH_TOKEN=GCFAmTWY2H7pLTnRXuyb5WP5tSDwWaqmtv076DYoXNR875RTeDXF1i8O1JlB5mh9
VOBIZ_NUMBER=+911173669938
```

## Step 2: Set up Vobiz Webhook in Vobiz Console

1. Go to **Vobiz Dashboard** → **SIP Trunk** → **Create Inbound Trunk**
2. Fill in:
   - **Trunk Name**: DigeeSell Voice Agent
   - **Primary Origination URI**: `https://unjeopardised-alissa-hillocked.ngrok-free.dev/vobiz/inbound`
   - **Webhooks Endpoint URL**: `https://unjeopardised-alissa-hillocked.ngrok-free.dev/vobiz/webhook`
   - Enable **Call Recording** (optional)

3. Click **Create Trunk**

4. After creating trunk, go **Linked Phone Numbers** → **Link Numbers** → Select your +91 11 7366938 → **Link**

## Step 3: Test the integration

Your server automatically adds the `/vobiz/inbound` endpoint. When someone calls your Vobiz number, it will:

1. Route to your webhook
2. Your server responds with TwiML (same as Twilio)
3. Caller hears the DigeeSell greeting
4. Caller can ask questions or press 9 to reach your team

## What the caller hears

```
"Hello! Thanks for calling DigeeSell. I am your AI assistant.
You can ask me about our services, pricing, or team.
Or press 9 at any time to speak with a team member."
```

Then they can:
- Ask: "What services do you offer?" → Gets answer from knowledge base
- Ask: "How many team members?" → Gets count from your API
- Press 9 → Gets transferred to +916389671091
- Say "Goodbye" → Call ends

## Outbound calls with Vobiz (optional future)

For outbound calls from Vobiz, you'll need their API. For now, you can keep using Twilio for outbound.

## Testing without recharging

You can test this setup immediately on trial. The webhook will work as soon as you:

1. Update `.env` with Vobiz credentials ✓
2. Add `/vobiz/inbound` endpoint to your server ✓
3. Configure webhook in Vobiz console (YOU DO THIS)
4. Have ngrok + npm start running
5. Call your Vobiz number

No recharge needed until you want to make outbound calls or need more features.
