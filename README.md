# Twilio Voice AI Assistant

An Express server that answers a Twilio phone call, asks why the caller is calling, uses OpenAI to classify intent, then queries your business API (e.g., user list / sales reps) and replies with dynamic speech. It also handles edge cases and falls back to a DTMF menu.

## Quick Start

1. **Install deps**
   ```bash
   npm i
   ```
2. **Copy env**
   ```bash
   cp .env.example .env
   # Fill values
   ```
3. **Run locally**
   ```bash
   npm run dev
   ```
4. **Expose via ngrok**
   ```bash
   ngrok http 5010
   ```
5. **Point your Twilio number**
   - Voice & Fax → A CALL COMES IN → Webhook (HTTP POST) → `https://<ngrok>/voice/inbound`

## Endpoints

- `POST /voice/inbound` — initial greeting + gather
- `POST /voice/collect` — handles speech/dtmf, NLU, and replies
- `POST /voice/retry` — reprompt flow
- `GET  /health` — health check

## Supported Intents (out of the box)

- `GET_SALES_REP_COUNT` — "how many sales reps are present/active/total?"
- `LIST_SALES_REPS` — "list sales reps / names"
- `HELP` — "help"
- `REPEAT` — "repeat that"
- else → graceful out-of-scope response

## Business API

This server hits `SALESREP_API_URL` and expects JSON shaped like:

```json
{
  "success": true,
  "data": [
    { "id": "usr1", "name": "Alice", "active": true },
    { "id": "usr2", "name": "Bob", "active": false }
  ]
}
```

If your schema differs, edit `src/services/knowledge.js` to map fields.

## Notes

- DTMF fallback:
  - Press 1 → sales rep count
  - Press 2 → list first 5 reps
- Speech hints tuned for en-IN by default; adjust `.env`.

# Voice-Agent
