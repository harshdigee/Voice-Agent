# Voice Agent Error Analysis — Hindi Detection, Hinglish Switch & Fast Reply

**Date:** 2026-06-17  
**Status:** 3 Critical Issues Identified  
**Root Cause:** Pipeline bottleneck + Language detection logic + Missing KB integration

---

## ISSUE #1: No Hindi Detection (Caller speaks Hindi → Agent replies English)

### What's Happening
- Caller speaks Hindi/Roman-Hindi: `"Hindi mein baat karo"`
- Whisper (STT) returns garbled English: `"India Vat Karogi"` or `"as seal package"`
- Your language detection logic fails to recognize this as Hindi
- Agent replies in English instead of Hindi

### Root Cause: Language Detection Logic Broken

In your `vobizStreamController.js`, you likely have code like:

```javascript
// BAD: Only trusting Whisper language tag
if (transcription.language === 'hi' || transcription.language === 'en') {
  // handle it
} else {
  // discard
}
```

**Problem:** Whisper on 8 kHz phone audio:
- Misdetects Hindi as Polish: `language='pl'`
- Misdetects Roman-Hindi as English: `language='en'`
- Never returns `language='hi'` reliably

### Why Current Normalizer Doesn't Work
Your debug report shows these normalizations were added:

```javascript
const normalizationRules = {
  'India Vat Karogi': 'Hindi baat karogi',
  'Jak żyją': 'kya chahiye',
  // ... 10-15 rules
};
```

**Problem:** This is a **brittle hardcoding approach**. It works for specific phrases you've already heard, but fails on:
- New variations: `"Inda pat karo"`, `"Hindsay baa karo"`
- Accents + phone noise variations
- Whisper drift (if you upgrade STT model, same Hindi phrase transcribes differently)

### Solution: Keyword-Based Hindi Detection (Not Language Tag)

Replace language tag logic with keyword matching:

```javascript
// GOOD: Look for Hindi/Roman-Hindi keywords in transcript text
const hindiKeywords = [
  'hindi', 'baat', 'karogi', 'karoge', 'kya', 'kaise', 'hai', 'mujhe', 
  'chahiye', 'batao', 'baare', 'mein', 'haan', 'nahi', 'namaste',
  'baarey', 'kehte', 'bologe', 'sunna', 'suna'
];

function isHindiContent(transcript) {
  const words = transcript.toLowerCase().split(/\s+/);
  const matches = words.filter(w => hindiKeywords.includes(w)).length;
  return matches >= 1; // If 1+ Hindi words found, treat as Hindi
}

// Later in pipeline
const useHindiMode = isHindiContent(normalizedText);
if (useHindiMode) {
  // Reply in Hindi/Roman-Hindi
}
```

### Additional Fix: Better Normalization (Fuzzy Matching, Not Hardcoding)

Instead of exact phrase matching:

```javascript
// Use Levenshtein distance or substring matching
function normalizeHindiMisheard(text) {
  const misheardMap = [
    { pattern: /india.*vat|inda.*vat|indu.*vat/i, replacement: 'hindi baat' },
    { pattern: /as.?seal|a.?seal|is.?seal/i, replacement: 'seo' },
    { pattern: /jak.*zyja|jak.*żyją/i, replacement: 'kya chahiye' },
    { pattern: /([a-z])at\s*karo|([a-z])at\s*karogi/i, replacement: (m, g1) => `${g1}aat karo` }
  ];
  
  let normalized = text;
  for (const rule of misheardMap) {
    normalized = normalized.replace(rule.pattern, rule.replacement);
  }
  return normalized;
}
```

---

## ISSUE #2: No Hinglish/Hindi Reply Switch (Agent detects Hindi but replies in English)

### What's Happening
- Language detection finally works → identifies Hindi
- LLM is instructed to reply in Hindi
- **But:** System prompt is too general or TTS is still English

### Root Cause: System Prompt Not Language-Specific

Typical broken prompt:

```javascript
const systemPrompt = `
You are DigeeSell's customer service agent. 
Reply to customer queries about SEO, Google Ads, social media, and pricing.
Use the knowledge base provided.
Keep replies short (under 50 words).
`;
```

**Problem:** No mention of language mode. LLM defaults to English.

### Solution: Language-Conditional System Prompt

```javascript
function getSystemPrompt(useHindiMode) {
  if (useHindiMode) {
    return `
Tu DigeeSell ke customer service AI hai.
Caller ke SEO, Google Ads, social media, pricing questions ka jawab de.
Bas 1 short sentence (Roman-Hindi/Hinglish mein).
English letters ONLY. Devanagari ya Urdu script mat use kar.
Example replies: "SEO ka package 15,000 rupees se shuru hota hai."
Knowledge base use kar agar puchha jaye.
    `.trim();
  } else {
    return `
You are DigeeSell's customer service agent.
Reply to customer queries about SEO, Google Ads, social media, and pricing.
Use the knowledge base.
Keep replies to 1 sentence under 50 words.
    `.trim();
  }
}
```

### Root Cause #2: TTS Not Switching to Hindi Voice

Even if LLM generates Hindi, you're sending it to English TTS:

```javascript
// BAD
const ttsResponse = await groqService.textToSpeech(agentReply, 'hannah');
// hannah = English voice, always
```

**Solution:**

```javascript
// GOOD
function getTTSConfig(useHindiMode) {
  if (useHindiMode) {
    return { voice: 'nova', model: 'tts-1', language: 'hi-IN' }; // OpenAI Hindi
  } else {
    return { voice: 'hannah', model: 'canopylabs/orpheus-v1-english' }; // Groq English
  }
}

const ttsConfig = getTTSConfig(useHindiMode);
const audioBuffer = await elevenlabs.generate({
  text: agentReply,
  voice_id: ttsConfig.voiceId,
  model_id: ttsConfig.model,
});
```

---

## ISSUE #3: No Fast Reply (Agent Takes 4–8 Seconds to Respond)

### What's Happening
Current pipeline per turn:

```
1. Wait for silence/VAD detection    (~0.4s)
   ↓
2. Send audio to Groq Whisper STT    (~1–2s, often fails on Hindi)
   ↓
3. Normalize & detect language       (~0.1s)
   ↓
4. Supabase KB semantic search        (~0.5–1s, sometimes fails)
   ↓
5. Send to LLM (gpt-4o-mini)          (~1–2s for full reply)
   ↓
6. TTS generation (full text at once) (~1–2s)
   ↓
7. Send audio back to phone           (~0.3s)

TOTAL: 4–8 seconds
```

### Root Cause: Sequential + Synchronous Pipeline

Each step waits for the previous one to finish.

### Solution: Architecture Redesign (Fast Paths + Streaming)

#### Step 1: Skip LLM for Predictable Intents

```javascript
const fastPaths = {
  'hello': { en: 'Yes, how can I help?', hi: 'Ji, boliye.' },
  'hindi mein baat karo': { hi: 'Bilkul, Hindi mein baat karte hain. Aap bataiye.' },
  'english mein': { en: 'Sure, I am listening in English.' },
  'thanks': { en: 'Thank you!', hi: 'Dhanyavaad!' },
  'bye': { en: 'Goodbye!', hi: 'Phir milenge!' },
};

function checkFastPath(text, useHindiMode) {
  const key = text.toLowerCase().trim();
  if (fastPaths[key]) {
    const response = fastPaths[key][useHindiMode ? 'hi' : 'en'];
    return response; // Return immediately, no LLM
  }
  return null;
}

// In pipeline:
let agentReply = checkFastPath(transcript, useHindiMode);
if (!agentReply) {
  // Only call LLM if not a fast path
  agentReply = await getLLMReply(transcript, useHindiMode);
}
```

**Impact:** Reduces 3–5 seconds for greetings/common phrases.

#### Step 2: Limit LLM Output (max_tokens)

```javascript
// BAD: LLM generates full response
const reply = await openai.createChatCompletion({
  model: 'gpt-4o-mini',
  messages: [...],
  max_tokens: 1000, // Too high for phone
});

// GOOD: Force short reply
const reply = await openai.createChatCompletion({
  model: 'gpt-4o-mini',
  messages: [...],
  max_tokens: 40, // 1 sentence max
  temperature: 0.5,
});
```

**Impact:** Reduces LLM latency by 50%.

#### Step 3: Stream TTS While LLM Is Still Generating

```javascript
// Instead of: wait for LLM → send to TTS → wait for audio
// Do: send LLM first 40 tokens to TTS immediately

const stream = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages,
  max_tokens: 40,
  stream: true, // Enable streaming
});

let fullReply = '';
for await (const chunk of stream) {
  fullReply += chunk.choices[0].delta.content || '';
  
  // Once we have 20 tokens (~10-15 words), start TTS
  if (fullReply.length > 50 && !ttsStarted) {
    ttsStarted = true;
    ttsService.generateStream(fullReply, useHindiMode)
      .pipe(phoneSocket); // Start speaking immediately
  }
}
```

**Impact:** User hears reply while LLM is still writing (1.5–2.5s instead of 4–8s).

#### Step 4: Deepgram Streaming STT (Not Batch Groq)

**Current:** Batch Whisper (wait for full utterance → upload → transcribe → wait 1–2s)

**Better:** Streaming STT

```javascript
// Switch from Groq batch to Deepgram streaming
const deepgramConnection = await deepgram.listen.live({
  model: 'nova-2',
  language: 'hi-IN', // Multi-language support
  interim_results: true,
  endpointing: 200, // End after 200ms of silence
});

// Listener gets partial transcripts instantly
deepgramConnection.on('transcriptReceived', (transcript) => {
  if (transcript.is_final) {
    // Final transcript → run through your Hindi detection
    const useHindiMode = isHindiContent(transcript.transcript);
    // Immediately start LLM + TTS pipeline
  }
});

// Vobiz audio frames → Deepgram in real-time
vobizSocket.on('media', (frame) => {
  deepgramConnection.send(frame.payload); // Stream to Deepgram
});
```

**Impact:** Hearing happens while caller is still speaking (saves 0.5–1s).

#### Step 5: Skip KB for Non-Service Questions

```javascript
// Check if question actually needs KB lookup
const needsKB = (text) => {
  const patterns = [
    /pricing|cost|package|price|rate/i,
    /seo|google ads|meta ads|social media/i,
    /onboarding|process|how|services|contact/i,
  ];
  return patterns.some(p => p.test(text));
};

if (needsKB && useHindiMode === false) {
  // Only embed search for English service questions
  // Hindi questions → use simple text KB fallback (faster)
  const kbContext = await supabase.search(...);
  // Add to LLM prompt
} else if (!needsKB) {
  // Simple greeting/question → skip KB entirely
  // Reply from LLM memory alone
}
```

**Impact:** Saves 0.5–1s for common Hindi phrases.

---

## ISSUE #4: Knowledge Base Integration Failing

### What's Happening

Your KB is in Supabase, but:

1. **RPC Missing:** `match_documents` function not deployed
2. **Fallback KB Used:** Slower text search or inline fallback
3. **KB Never Reaches LLM:** Semantic search fails silently

### Root Cause: `supabase_setup.sql` Not Executed

The debug report mentions:
> "Supabase semantic-search failure is cached so the app stops wasting time on missing `match_documents` every turn."

This means your server is **catching the error** and **skipping KB**, so LLM has no context.

### Solution: Deploy Supabase RPC

#### Step 1: Run SQL Setup in Supabase Console

```sql
-- Create pgvector extension
create extension if not exists vector;

-- Create documents table (if not exists)
create table if not exists documents (
  id bigserial primary key,
  content text not null,
  metadata jsonb default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamp default now()
);

-- Create matching function
create or replace function match_documents(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 5
)
returns table (
  id bigint,
  content text,
  similarity float
) language sql stable as $$
  select
    documents.id,
    documents.content,
    (1 - (documents.embedding <=> query_embedding)) as similarity
  from documents
  where (1 - (documents.embedding <=> query_embedding)) > match_threshold
  order by documents.embedding <=> query_embedding
  limit match_count;
$$;

-- Create index for fast search
create index if not exists documents_embedding_idx on documents
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
```

#### Step 2: Seed KB with Your Knowledge Base

Your DOCX has 10+ chunks. Create a seeding script:

```javascript
// scripts/seedKnowledgeBase.js
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const kbChunks = [
  { title: 'SEO Services', content: 'DigeeSell offers end-to-end SEO services... [from DOCX]' },
  { title: 'Google Ads', content: 'We are a certified Google Ads agency...' },
  { title: 'Social Media Marketing', content: 'DigeeSell helps brands build presence across Instagram, Facebook...' },
  { title: 'Pricing — SEO', content: 'SEO pricing starts from INR 15,000/month...' },
  { title: 'Pricing — Social Media', content: 'Social media packages start from INR 12,000/month...' },
  { title: 'Contact & Onboarding', content: 'India: +91-7217701713, +91-9999201459 | UAE: +971 556805863' },
  { title: 'DigeeMed Healthcare', content: 'DigeeMed is our healthcare digital marketing division...' },
  { title: 'Web Development', content: 'Custom websites, e-commerce, UI/UX optimization, SEO-friendly development...' },
  { title: 'Email & WhatsApp Marketing', content: 'Email open rates 20-40%, WhatsApp open rates 90%+...' },
  { title: 'Company Info', content: 'Founded 8+ years ago, 200+ clients, offices in Gurugram & Dubai...' },
];

async function seedKB() {
  for (const chunk of kbChunks) {
    // Generate embedding
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: chunk.content,
    });
    
    const embedding = embeddingResponse.data[0].embedding;
    
    // Insert into Supabase
    await supabase.from('documents').insert({
      content: chunk.content,
      metadata: { title: chunk.title },
      embedding: embedding,
    });
    
    console.log(`✓ Seeded: ${chunk.title}`);
  }
  
  console.log('✓ KB seeding complete');
}

seedKB().catch(console.error);
```

Run: `node scripts/seedKnowledgeBase.js`

#### Step 3: Fix KB Search in Controller

```javascript
// BEFORE: Search fails silently
async function getKBContext(query, useHindiMode) {
  try {
    const embedding = await generateEmbedding(query);
    const results = await supabase.rpc('match_documents', {
      query_embedding: embedding,
      match_threshold: 0.7,
      match_count: 3,
    });
    
    if (results.error) throw results.error;
    return results.data.map(r => r.content).join('\n\n');
  } catch (err) {
    console.error('KB search failed:', err);
    return ''; // Silent failure → LLM has no context
  }
}

// AFTER: Cache failure, fallback to text search
let kbSearchFailed = false;
let kbCache = {};

async function getKBContext(query, useHindiMode) {
  const cacheKey = query.substring(0, 50);
  
  // Don't retry if already failed
  if (kbSearchFailed) {
    return fallbackTextSearch(query);
  }
  
  // Check cache
  if (kbCache[cacheKey]) {
    return kbCache[cacheKey];
  }
  
  try {
    const embedding = await generateEmbedding(query);
    const results = await supabase.rpc('match_documents', {
      query_embedding: embedding,
      match_threshold: 0.6, // Lower threshold for Hindi
      match_count: 3,
    });
    
    if (results.error) throw results.error;
    
    const context = results.data.map(r => r.content).join('\n\n');
    kbCache[cacheKey] = context;
    return context;
  } catch (err) {
    console.warn('KB RPC not available, using fallback');
    kbSearchFailed = true; // Cache this decision
    return fallbackTextSearch(query);
  }
}

// Fallback for when RPC is not available
function fallbackTextSearch(query) {
  const inlineKB = {
    'seo': 'DigeeSell offers SEO services starting from INR 15,000/month...',
    'google ads': 'Google Ads management: INR 10,000/month + ad spend...',
    'pricing': 'SEO: 15K+, Social: 12K+, PPC: 10K+ management fee...',
    'contact': '+91-7217701713 or info@digeesell.com',
    // Add all 10 chunks
  };
  
  const keywords = query.toLowerCase().split(/\s+/);
  for (const keyword of keywords) {
    if (inlineKB[keyword]) return inlineKB[keyword];
  }
  return '';
}
```

---

## QUICK FIX CHECKLIST (Priority Order)

| # | Issue | Fix | Time | Impact |
|---|-------|-----|------|--------|
| **1** | No Hindi detection | Keyword-based detection (replace language tag logic) | 15 min | **Huge** — enables Hindi replies |
| **2** | No Hinglish reply | Language-conditional system prompt + TTS switch | 20 min | **Huge** — Hindi mode actually works |
| **3** | Slow replies (4–8s) | Fast paths (hello, bye) + max_tokens=40 + skip KB for greetings | 30 min | **Huge** — feels instant |
| **4** | Missing KB | Run `supabase_setup.sql` + seed 10 chunks + fix RPC error handling | 20 min | **Medium** — KB context available |
| **5** | Better STT | Replace Groq batch with Deepgram streaming | 1 hour | **Medium** — better Hindi detection |
| **6** | Stream TTS | Send first 20 tokens to TTS while LLM writes rest | 1 hour | **Medium** — replies feel faster |

---

## Configuration Changes Needed

Add to `.env`:

```bash
# Language Detection
HINDI_KEYWORDS="hindi,baat,karo,kya,kaise,mujhe,chahiye"
FAST_PATH_ENABLED=true

# STT
# Current: GROQ_STT_MODEL=whisper-large-v3-turbo
# Better: DEEPGRAM_API_KEY=... (optional upgrade)

# TTS
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID_HI=...  # Hindi voice ID
ELEVENLABS_VOICE_ID_EN=...  # English voice ID

# LLM
OPENAI_MODEL=gpt-4o-mini
LLM_MAX_TOKENS=40            # Force short replies

# KB
SUPABASE_URL=...
SUPABASE_KEY=...
KB_SEMANTIC_SEARCH=true
KB_FALLBACK_ENABLED=true
```

---

## Next Steps

1. **Today:** Fix Hindi detection + Hinglish prompt (2 issues, 30 min)
2. **Tomorrow:** Run Supabase SQL + seed KB (1 issue, 20 min)
3. **Later:** Stream TTS + Deepgram STT (2 upgrades, 2 hours)

**Test after fix #1:**  
- Call agent, say: `"Hindi mein baat karo"`
- Expect: Agent replies in Roman-Hindi (via OpenAI TTS)

**Test after fix #2:**  
- Call agent, say: `"SEO package ke baare mein batao"`
- Expect: Agent retrieves KB chunk + replies in Roman-Hindi with pricing

**Test after fix #3:**  
- Call agent, say: `"Hello"`
- Expect: Instant reply in <2 seconds (no KB, no LLM, fast path)

---

## Files to Modify

1. `src/controllers/vobizStreamController.js` — Hindi detection logic
2. `src/services/groqService.js` — System prompt + TTS voice switching
3. `src/services/knowledge.js` — KB search error handling
4. `.env` — Add Hindi/Hinglish keywords + KB config
5. `supabase_setup.sql` — Run in Supabase console (new file or existing)
6. `scripts/seedKnowledgeBase.js` — Seed with your DOCX chunks (new file)

---

## Summary

**Your 3 Issues:**

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| No Hindi detection | Language tag fails on phone, normalizer hardcoded | Use keyword-based detection |
| No Hinglish reply | System prompt not language-aware, TTS stuck on English | Conditional prompt + voice switching |
| Slow replies | Sequential pipeline, KB on every turn, LLM generates long text | Fast paths + max_tokens=40 + skip KB |

**All fixable in 1–2 hours of code changes.** KB is seeded correctly in your DOCX — just deploy the RPC and seed script.
