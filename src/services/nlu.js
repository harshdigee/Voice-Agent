import fetch from "node-fetch";
import { z } from "zod";
import { CONFIG } from "../config.js";
import { log } from "../utils/logger.js";

const IntentSchema = z.object({
  intent: z.enum([
    "GET_SALES_REP_COUNT",
    "LIST_SALES_REPS",
    "KNOWLEDGE_QUERY",
    "FORWARD_TO_HUMAN",
    "HELP",
    "REPEAT",
    "GOODBYE",
    "UNKNOWN",
  ]),
  params: z
    .object({
      activeOnly: z.boolean().optional(),
    })
    .optional(),
});

const SYSTEM_PROMPT = `You are a call center NLU for DigeeSell, a digital marketing agency.
Classify the caller's request into exactly one intent.

Return ONLY valid JSON: {"intent":"...", "params":{}}

Intents:
- GET_SALES_REP_COUNT: caller asks how many sales reps / team members (total or active/present)
- LIST_SALES_REPS: caller asks to list names of sales reps
- KNOWLEDGE_QUERY: caller asks about services, pricing, company info, SEO, social media, FAQ — anything business-related
- FORWARD_TO_HUMAN: caller says "talk to someone", "human", "agent", "representative", "transfer", "connect me", or presses 9
- HELP: caller asks for help or options
- REPEAT: caller says "repeat" or "again"
- GOODBYE: caller says bye, goodbye, thanks, that's all
- UNKNOWN: anything else

If caller says "present" or "active" with sales rep intent, set params.activeOnly=true.`;

export async function classifyUtterance(text) {
  const t = (text || "").toLowerCase().trim();
  if (!t) return { intent: "UNKNOWN" };

  // Fast local heuristics
  if (/(^|\s)(bye|goodbye|thanks|thank you|that'?s all|no more)(\s|$)/i.test(t)) return { intent: "GOODBYE" };
  if (/(repeat|say that again)/i.test(t)) return { intent: "REPEAT" };
  if (/(help|options|menu|what can you)/i.test(t)) return { intent: "HELP" };
  if (/(talk to|speak to|connect me|transfer|human|agent|real person|someone)/i.test(t)) return { intent: "FORWARD_TO_HUMAN" };

  if (/(sales?\s*rep|representative)/i.test(t)) {
    if (/(how\s*many|count|number|present|active|available)/i.test(t)) {
      return { intent: "GET_SALES_REP_COUNT", params: { activeOnly: /(present|active|available)/i.test(t) } };
    }
    if (/(list|names?|show)/i.test(t)) return { intent: "LIST_SALES_REPS" };
  }

  // Business question heuristics → KB
  if (/(service|price|pricing|seo|social media|marketing|brand|website|email|whatsapp|reputation|ecommerce|about|faq|case study|offer|package|cost|how much|what do you|digee)/i.test(t)) {
    return { intent: "KNOWLEDGE_QUERY" };
  }

  // Fall back to OpenAI if configured
  if (!CONFIG.OPENAI_API_KEY) return { intent: "UNKNOWN" };

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CONFIG.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CONFIG.OPENAI_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      }),
    });
    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content?.trim();
    const parsed = IntentSchema.safeParse(JSON.parse(content));
    if (parsed.success) return parsed.data;
    log.warn("OpenAI parse failed:", content);
  } catch (err) {
    log.error("OpenAI NLU error:", err.message);
  }

  return { intent: "UNKNOWN" };
}
