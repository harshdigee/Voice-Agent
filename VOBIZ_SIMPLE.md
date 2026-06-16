# Vobiz SIP Trunk Configuration — Copy-Paste Values

## What to enter in Vobiz Dashboard

### Location
Go to: **Vobiz Console** → **SIP Trunk** → **Create Inbound Trunk**

### Form Fields

**Field 1: Trunk Name**
```
DigeeSell Voice Agent
```
(Any friendly name you like)

---

**Field 2: Primary Origination URI**
```
https://unjeopardised-alissa-hillocked.ngrok-free.dev/vobiz/inbound
```
This is where incoming calls are routed.

---

**Field 3: Call Recording** (optional)
```
Disabled (leave unchecked)
```
Or enable if you want automatic recordings.

---

**Field 4: Link Phone Numbers**
After creating the trunk:
1. Click **"Link Numbers"**
2. Select your number: `+91 11 7366938`
3. Click **Link**

---

## That's it!

Now when someone calls `+91 11 7366938`, it will:
1. Hit your webhook at `https://unjeopardised-alissa-hillocked.ngrok-free.dev/vobiz/inbound`
2. Your AI agent responds
3. Caller can ask questions or press 9 to reach your team

---

## Important

Make sure you have BOTH running before testing:

**Terminal 1:**
```bash
cd /Users/harsh/Desktop/twilio-voice-assistant && npm start
```

**Terminal 2:**
```bash
ngrok http 5010
```

Only then will the webhook be accessible from Vobiz.

---

## Your Credentials (for reference)

```
Vobiz Number: +91 11 7366938
Auth ID: MA_8V9BUALX
Auth Token: GCFAmTWY2H7pLTnRXuyb5WP5tSDwWaqmtv076DYoXNR875RTeDXF1i8O1JlB5mh9
```

(Already saved in `.env` — don't share these!)
