import fetch from 'node-fetch';
import { z } from 'zod';
import { CONFIG } from '../config.js';
import { log } from '../utils/logger.js';

const IntentSchema = z.object({
  intent: z.enum([
    'GET_SALES_REP_COUNT',
    'LIST_SALES_REPS',
    'HELP',
    'REPEAT',
    'UNKNOWN'
  ]),
  params: z.object({
    activeOnly: z.boolean().optional() // For "present/active" phrasing
  }).optional()
});

const SYSTEM_PROMPT = `
You are a call center NLU for a roofing CRM. Classify the caller's request.

Return ONLY JSON with:
{"intent":"...", "params":{...}}

Intents:
- GET_SALES_REP_COUNT: User asks how many sales reps, total or active/present.
- LIST_SALES_REPS: User asks to list names of sales reps.
- HELP: User asks for help or options.
- REPEAT: User says "repeat".
- UNKNOWN: Anything else.

If user says "present" or "active", set params.activeOnly=true.
`;

export async function classifyUtterance(text) {
  // Safe offline heuristic first
  const t = (text || '').toLowerCase();

  if (!t.trim()) {
    return { intent: 'UNKNOWN' };
  }

  if (/(repeat|again)/i.test(t)) return { intent: 'REPEAT' };
  if (/(help|options|menu)/i.test(t)) return { intent: 'HELP' };

  if (/(sales?\s*reps?|representatives?)/i.test(t)) {
    if (/(how\s*many|count|number|present|active|available)/i.test(t)) {
      return { intent: 'GET_SALES_REP_COUNT', params: { activeOnly: /(present|active|available)/i.test(t) } };
    }
    if (/(list|names?|show)/i.test(t)) {
      return { intent: 'LIST_SALES_REPS' };
    }
  }

  // If OpenAI not configured, fall back
  if (!CONFIG.OPENAI_API_KEY) {
    return { intent: 'UNKNOWN' };
  }

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CONFIG.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: CONFIG.OPENAI_MODEL,
        temperature: 0.1,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text }
        ]
      })
    });

    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content?.trim();
    const parsed = IntentSchema.safeParse(JSON.parse(content));
    if (parsed.success) {
      return parsed.data;
    }
    log.warn('OpenAI parse failed, content:', content);
  } catch (err) {
    log.error('OpenAI NLU error:', err);
  }

  return { intent: 'UNKNOWN' };
}
