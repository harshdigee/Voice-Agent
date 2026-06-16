import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "../config.js";
import { log } from "../utils/logger.js";

// ─── Supabase client ────────────────────────────────────────────────────────
let _supabase = null;
function getSupabase() {
  if (!_supabase && CONFIG.SUPABASE.URL && CONFIG.SUPABASE.SERVICE_KEY) {
    _supabase = createClient(CONFIG.SUPABASE.URL, CONFIG.SUPABASE.SERVICE_KEY);
  }
  return _supabase;
}

// ─── Embed a query with OpenAI ───────────────────────────────────────────────
async function embedText(text) {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CONFIG.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  const json = await resp.json();
  return json?.data?.[0]?.embedding || null;
}

// ─── Search Supabase docs ─────────────────────────────────────────────────────
// Uses semantic search (match_documents RPC) if available, else text search.
export async function searchKnowledge(query, topK = 3) {
  const supabase = getSupabase();
  if (!supabase) {
    log.warn("Supabase not configured, skipping knowledge search");
    return [];
  }

  // Try semantic search first
  if (CONFIG.OPENAI_API_KEY) {
    try {
      const embedding = await embedText(query);
      if (embedding) {
        const { data, error } = await supabase.rpc("match_documents", {
          query_embedding: embedding,
          match_threshold: 0.5,
          match_count: topK,
        });
        if (!error && data && data.length > 0) {
          log.info(`Supabase semantic search returned ${data.length} results`);
          return data.map((r) => r.content);
        }
        if (error) log.warn("match_documents RPC not available, using text search:", error.message);
      }
    } catch (err) {
      log.warn("Semantic search failed, falling back to text search:", err.message);
    }
  }

  // Fallback: keyword text search across documents
  try {
    const keywords = query.split(" ").filter((w) => w.length > 3).slice(0, 4);
    const searchTerm = keywords.length ? keywords[0] : query.slice(0, 20);

    const { data, error } = await supabase
      .from("documents")
      .select("content, category")
      .ilike("content", `%${searchTerm}%`)
      .limit(topK);

    if (error) { log.error("Text search error:", error.message); return []; }
    log.info(`Text search for "${searchTerm}" returned ${(data || []).length} results`);
    return (data || []).map((r) => r.content);
  } catch (err) {
    log.error("searchKnowledge fallback error:", err.message);
    return [];
  }
}

// ─── Answer a general question using KB + OpenAI ────────────────────────────
export async function answerFromKnowledge(question) {
  const chunks = await searchKnowledge(question, 4);

  if (!chunks.length) {
    return "I don't have specific information about that right now. Is there anything else I can help you with?";
  }

  const context = chunks.join("\n\n");

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CONFIG.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CONFIG.OPENAI_MODEL,
        temperature: 0.3,
        max_tokens: 200,
        messages: [
          {
            role: "system",
            content: `You are a helpful voice assistant for DigeeSell. Answer the caller's question using ONLY the context below. 
Keep answers SHORT (2-3 sentences max) since this is a phone call. 
Do not mention "context" or "documents". Speak naturally.

Context:
${context}`,
          },
          { role: "user", content: question },
        ],
      }),
    });
    const json = await resp.json();
    return json?.choices?.[0]?.message?.content?.trim() || "I'm not sure about that. Let me connect you to our team.";
  } catch (err) {
    log.error("answerFromKnowledge OpenAI error:", err.message);
    return "I had trouble fetching that answer. Let me connect you to our team.";
  }
}

// ─── Sales rep helpers (kept for backward compat) ───────────────────────────
function buildAuthHeaders() {
  const headers = {};
  switch (CONFIG.SALESREP_API.AUTH_TYPE) {
    case "bearer":
      headers["Authorization"] = `Bearer ${CONFIG.SALESREP_API.BEARER}`;
      break;
    case "header":
      if (CONFIG.SALESREP_API.HEADER_KEY) {
        headers[CONFIG.SALESREP_API.HEADER_KEY] = CONFIG.SALESREP_API.HEADER_VALUE || "";
      }
      break;
    default:
      break;
  }
  return headers;
}

export async function fetchSalesReps() {
  if (!CONFIG.SALESREP_API.URL) {
    return { ok: false, error: "SALESREP_API_URL not configured", data: [] };
  }
  const headers = { "Content-Type": "application/json", ...buildAuthHeaders() };
  try {
    const resp = await fetch(CONFIG.SALESREP_API.URL, { headers });
    const rawText = await resp.text();
    let json;
    try { json = JSON.parse(rawText); } catch { return { ok: false, error: "Invalid JSON", data: [] }; }
    const list = json?.users || json?.data || [];
    const normalized = list.map((u, i) => ({
      id: u.user_id || `u${i}`,
      name: u.username || "Unknown",
      email: u.email || "N/A",
      role: u.role || "sales_rep",
      active: u.status === "active",
    }));
    return { ok: true, data: normalized };
  } catch (err) {
    return { ok: false, error: String(err), data: [] };
  }
}

export function getCounts(reps, { activeOnly = false } = {}) {
  const total = reps.length;
  const active = reps.filter((r) => r.active).length;
  return { total, active, result: activeOnly ? active : total };
}

export function listNames(reps, limit = 5) {
  return reps.slice(0, limit).map((r) => r.name || "Unknown");
}
