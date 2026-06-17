/**
 * Seed DigeeSell KB into Supabase documents table.
 * Run once: node scripts/seedKnowledge.js
 *
 * Also run supabase_setup.sql in Supabase SQL Editor for match_documents RPC.
 */

import dotenv from "dotenv";
import path from "path";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import { DIGEESELL_KB } from "../src/data/digeesellKb.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(url, key);

async function embed(text) {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  const json = await resp.json();
  if (!json?.data?.[0]?.embedding) throw new Error(json.error?.message || "embed failed");
  return json.data[0].embedding;
}

async function main() {
  console.log(`Seeding ${DIGEESELL_KB.length} documents…`);

  const { error: delErr } = await supabase.from("documents").delete().neq("id", 0);
  if (delErr) console.warn("Clear warning (table may be empty):", delErr.message);

  for (const doc of DIGEESELL_KB) {
    let row = { content: doc.content, category: doc.category };
    if (openaiKey) {
      try {
        row.embedding = await embed(doc.content);
      } catch (e) {
        console.warn(`No embedding for ${doc.category}:`, e.message);
      }
    }
    const { error } = await supabase.from("documents").insert(row);
    if (error) {
      console.error(`Insert failed (${doc.category}):`, error.message);
      process.exit(1);
    }
    console.log(`  ✓ ${doc.category}`);
  }

  console.log("Done. Run supabase_setup.sql in Supabase SQL Editor if match_documents is missing.");
}

main().catch((e) => { console.error(e); process.exit(1); });
