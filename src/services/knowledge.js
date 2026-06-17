import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "../config.js";
import { log } from "../utils/logger.js";
import { DIGEESELL_KB } from "../data/digeesellKb.js";

// ─── Supabase client ────────────────────────────────────────────────────────
let _supabase = null;
let _semanticSearchAvailable = true;
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
      Authorization: `Bearer ${CONFIG.OPENAI.API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  const json = await resp.json();
  return json?.data?.[0]?.embedding || null;
}

// ─── Inline fallback when Supabase is empty or RPC missing ───────────────────
function searchFallbackKb(query, topK = 3) {
  const terms = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const scored = DIGEESELL_KB.map((doc) => {
    const hay = `${doc.category} ${doc.content}`.toLowerCase();
    let score = 0;
    for (const t of terms) if (hay.includes(t)) score++;
    return { ...doc, score };
  })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  if (scored.length) log.info(`Inline KB fallback returned ${scored.length} results`);
  return scored.map((r) => r.content);
}

// ─── Search Supabase docs ─────────────────────────────────────────────────────
// Uses semantic search (match_documents RPC) if available, else text search.
export async function searchKnowledge(query, topK = 3) {
  const supabase = getSupabase();
  if (!supabase) {
    log.warn("Supabase not configured, using inline KB");
    return searchFallbackKb(query, topK);
  }

  // Try semantic search first
  if (CONFIG.OPENAI.API_KEY && _semanticSearchAvailable) {
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
        if (error) {
          log.warn("match_documents RPC not available, using text search:", error.message);
          if (/function .*match_documents|schema cache/i.test(error.message || "")) {
            _semanticSearchAvailable = false;
          }
        }
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

    if (error) { log.error("Text search error:", error.message); return searchFallbackKb(query, topK); }
    log.info(`Text search for "${searchTerm}" returned ${(data || []).length} results`);
    const rows = (data || []).map((r) => r.content);
    return rows.length ? rows : searchFallbackKb(query, topK);
  } catch (err) {
    log.error("searchKnowledge fallback error:", err.message);
    return searchFallbackKb(query, topK);
  }
}

// ─── Answer a general question using KB context (used as helper) ─────────────
// The primary answer path is now groqService.chat() which calls searchKnowledge().
// This function is kept for backward compatibility.
export async function answerFromKnowledge(question) {
  const chunks = await searchKnowledge(question, 3);
  if (!chunks.length) return "";
  return chunks.join(" ");
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
