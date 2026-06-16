# DigeeSell Voice AI — Quick Setup Reference

## What You Have Now

✅ **Twilio** (Outbound calls to India)
- Number: +17178959511
- Use: Calling customers at +916389671091
- Command: `node makeOutboundCall.js`

✅ **Vobiz** (Inbound calls from India)  
- Number: +91 11 7366938
- Use: Customers call you
- Webhook: `https://unjeopardised-alissa-hillocked.ngrok-free.dev/vobiz/inbound`

✅ **Knowledge Base** (Supabase)
- Stores DigeeSell services, FAQs, pricing
- AI answers caller questions
- Updated in real-time

---

## To Set Up Vobiz Inbound (One-time setup)

### 1. In Vobiz Dashboard

Go to: **SIP Trunk** → **Create Inbound Trunk**

Fill in:
```
Trunk Name: DigeeSell Voice Agent
Primary Origination URI: https://unjeopardised-alissa-hillocked.ngrok-free.dev/vobiz/inbound
Call Recording: Disabled (or Enabled if you want)
```

Then: **Linked Phone Numbers** → **Link Numbers** → Link `+91 11 7366938`

### 2. Done!

Your Vobiz number (+91 11 7366938) now routes to the AI voice agent.

---

## Running Everything

**Terminal 1:**
```bash
cd /Users/harsh/Desktop/twilio-voice-assistant
npm start
```

**Terminal 2:**
```bash
ngrok http 5010
```

**Terminal 3 (to make outbound Twilio call):**
```bash
cd /Users/harsh/Desktop/twilio-voice-assistant
node makeOutboundCall.js
```

---

## What Happens When Someone Calls Your Vobiz Number

```
Caller dials +91 11 7366938
           ↓
    Vobiz routes to webhook
           ↓
    Your server responds with TwiML
           ↓
Caller hears: "Hello! Thanks for calling DigeeSell..."
           ↓
Caller asks: "What services do you offer?"
           ↓
AI responds: (from Supabase knowledge base)
           ↓
Caller presses 9
           ↓
Call transfers to +916389671091 (your team)
```

---

## Knowledge Base (Supabase)

Your knowledge base contains:
- Services (SEO, Social Media, Email Marketing, etc.)
- Pricing
- Case studies
- FAQs
- Team info

When caller asks a question, the AI searches this KB and responds naturally.

To add more content:
1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/qmpleirkfyehhumybakm/editor)
2. Edit the `documents` table
3. Add new rows with content + category
4. AI automatically uses it in the next call

---

## Testing Without Recharging

✅ Vobiz inbound works on trial — no recharge needed
✅ Twilio outbound also works (you verified +916389671091)
❌ Twilio inbound blocked on trial (international calls not allowed)

---

## Cost Estimate

- **Vobiz**: ~₹500/month for the number
- **Twilio**: ~$1-2/month (minimal usage on trial)
- **Supabase**: Free tier (includes KB storage)
- **OpenAI API**: ~$0.50-2/month for LLM calls

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `EADDRINUSE port 5010` | `kill $(lsof -ti:5010)` |
| ngrok ERR_NGROK_334 | `pkill -f ngrok` |
| "Invalid number" on inbound | Number not verified in Vobiz |
| KB not responding | Check `OPENAI_API_KEY` in `.env` |
| Call disconnects | Check ngrok URL is updated in Vobiz webhook |

---

## Next Steps

1. ✅ Set up Vobiz webhook (you do this in their console)
2. ✅ Have ngrok + npm start running
3. ✅ Call +91 11 7366938 from any phone
4. ✅ Test the AI agent
5. (Optional) Upgrade Twilio if you need inbound calls to US number

