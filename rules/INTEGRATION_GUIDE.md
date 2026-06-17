# Integration Guide: Wiring the Fixes into Your Voice Agent

This guide shows exactly where to add/replace code in your existing `vobizStreamController.js` to integrate the 4 fixes.

---

## Overview of Changes

| File | Change | Impact |
|------|--------|--------|
| `src/services/languageDetectionService.js` | **NEW** - Keyword-based Hindi detection | Fix: No Hindi detection |
| `src/services/promptService.js` | **NEW** - Language-aware system prompts | Fix: No Hinglish reply |
| `src/services/fastPathService.js` | **NEW** - Instant replies for greetings | Fix: Slow replies |
| `src/controllers/vobizStreamController.js` | **MODIFY** - Integrate 3 services above | Wires everything together |
| `supabase_setup.sql` | **NEW** - Deploy in Supabase console | Fix: Missing KB RPC |
| `scripts/seedKnowledgeBase.js` | **NEW** - Run once to populate KB | Seed KB with 12 chunks |
| `.env` | **MODIFY** - Add new config variables | New configuration |

---

## Step 1: Add New Service Files

Create 3 new files in your `src/services/` directory:

```
src/services/
├── languageDetectionService.js   (paste from provided file)
├── promptService.js               (paste from provided file)
├── fastPathService.js             (paste from provided file)
├── (existing files...)
```

Copy the complete content from the 3 files provided above into your project.

---

## Step 2: Modify vobizStreamController.js

### Import the New Services

Add these imports at the top of `vobizStreamController.js`:

```javascript
import { shouldUseHindiMode } from '../services/languageDetectionService.js';
import { buildLLMParameters, getTTSConfig } from '../services/promptService.js';
import { checkFastPath } from '../services/fastPathService.js';
```

### Find the STT Response Handler

Look for the section where you process Whisper STT results. It will look something like:

```javascript
// BEFORE (old code)
const { text, language } = transcriptionResult;

// Process transcript
if (!isValidTranscript(text)) {
  console.log('Transcript discarded');
  return;
}

// Generate LLM response
const agentReply = await generateLLMResponse(text);

// Send TTS
const audioBuffer = await textToSpeech(agentReply, 'hannah');
```

### Replace with New Logic

```javascript
// AFTER (new code with fixes)
const { text, language } = transcriptionResult;

// ========================================
// FIX 1: Better Hindi Detection
// ========================================
const useHindiMode = shouldUseHindiMode(text, language);
console.log(`Language detection: useHindiMode=${useHindiMode}`);

if (!isValidTranscript(text)) {
  console.log('Transcript discarded');
  return;
}

// ========================================
// FIX 3: Fast Paths (No LLM for Greetings)
// ========================================
let agentReply = checkFastPath(text, useHindiMode);

if (agentReply) {
  console.log(`✓ Fast path matched: ${agentReply}`);
  // Fast reply found, skip LLM entirely
} else {
  console.log('No fast path, querying LLM...');
  
  // ========================================
  // FIX 2 & KB Integration: LLM with Language-Aware Prompt
  // ========================================
  
  // Get KB context (if needed)
  let kbContext = '';
  if (shouldQueryKB(text, useHindiMode)) {
    try {
      kbContext = await getKBContext(text, useHindiMode);
      console.log(`KB context found: ${kbContext.substring(0, 100)}...`);
    } catch (err) {
      console.warn('KB search failed, proceeding without context');
    }
  }
  
  // Build LLM parameters (uses language-aware prompt)
  const llmParams = buildLLMParameters(useHindiMode, kbContext, text);
  
  // Call LLM with short reply constraint
  const completion = await openai.chat.completions.create(llmParams);
  agentReply = completion.choices[0].message.content.trim();
  
  console.log(`LLM reply: ${agentReply}`);
}

// ========================================
// FIX 2: Use Hindi TTS if in Hindi Mode
// ========================================
const ttsConfig = getTTSConfig(useHindiMode);
console.log(`TTS: provider=${ttsConfig.provider}, voice=${ttsConfig.voice}`);

let audioBuffer;
if (ttsConfig.provider === 'elevenlabs') {
  // Use ElevenLabs for Hindi voice quality
  audioBuffer = await elevenlabs.generate({
    text: agentReply,
    voice_id: ttsConfig.voice,
    model_id: ttsConfig.model,
  });
} else {
  // Use Groq/OpenAI for English
  audioBuffer = await textToSpeech(agentReply, ttsConfig.voice);
}

// Send to phone
sendAudioToPhone(audioBuffer);
```

---

## Step 3: Add/Update Helper Functions

### Add KB Query Check

```javascript
/**
 * Decide if we should query KB for this question
 * Skip KB for simple greetings or short utterances
 */
function shouldQueryKB(transcript, useHindiMode) {
  // Don't query KB for very short utterances
  if (transcript.split(/\s+/).length < 3) {
    return false;
  }
  
  // Query KB for service/pricing questions
  const kbPatterns = [
    /pricing|cost|package|price|rate/i,
    /seo|google ads?|meta ads?|social media/i,
    /service|onboarding|process|how|contact/i,
    /website|development|marketing|contact/i,
  ];
  
  return kbPatterns.some(p => p.test(transcript));
}

/**
 * Get KB context using Supabase semantic search (with fallback)
 */
async function getKBContext(transcript, useHindiMode) {
  try {
    // Generate embedding for query
    const embedding = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: transcript,
    });
    
    // Search Supabase
    const { data, error } = await supabase.rpc('match_documents', {
      query_embedding: embedding.data[0].embedding,
      match_threshold: useHindiMode ? 0.6 : 0.7, // Lower threshold for Hindi
      match_count: 3,
    });
    
    if (error) throw error;
    
    // Extract top results
    return data
      .map(doc => `${doc.content}`)
      .join('\n\n');
      
  } catch (err) {
    console.warn('Semantic search failed, trying text search...');
    
    // Fallback: Text search
    const { data: textResults, error: textErr } = await supabase.rpc(
      'search_documents_text',
      { search_query: transcript, limit_count: 3 }
    );
    
    if (textErr) {
      console.warn('Text search also failed:', textErr);
      return '';
    }
    
    return textResults
      .map(doc => `${doc.content}`)
      .join('\n\n');
  }
}
```

### Update Validation

```javascript
/**
 * Check if transcript is valid (not empty, not pure noise)
 */
function isValidTranscript(text) {
  if (!text || text.length === 0) return false;
  
  // Skip transcripts that are just numbers or single words
  const words = text.trim().split(/\s+/);
  if (words.length === 0) return false;
  
  // Remove if it's only punctuation or common Whisper hallucinations
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  if (cleaned.length < 2) return false;
  
  return true;
}
```

---

## Step 4: Update .env Configuration

Add these new variables to your `.env` file:

```bash
# ========================================
# Language Detection
# ========================================
# Hindi keywords used for detection (comma-separated)
HINDI_KEYWORDS="hindi,baat,karo,kya,kaise,mujhe,chahiye,seo,google"

# ========================================
# STT Configuration
# ========================================
# Current: Keep your existing Groq setup
GROQ_STT_MODEL=whisper-large-v3-turbo

# Optional upgrade later:
# DEEPGRAM_API_KEY=your_key_here
# DEEPGRAM_MODEL=nova-2

# ========================================
# TTS Configuration
# ========================================
# ElevenLabs for Hindi voice quality
ELEVENLABS_API_KEY=your_api_key_here
ELEVENLABS_MODEL=eleven_turbo_v2_5

# Voice IDs (get these from ElevenLabs dashboard)
ELEVENLABS_VOICE_ID_HI=nova    # Hindi voice
ELEVENLABS_VOICE_ID_EN=hannah   # English voice

# Alternative: Keep using OpenAI TTS for Hindi
OPENAI_TTS_MODEL=tts-1
OPENAI_TTS_VOICE_HI=nova
OPENAI_TTS_VOICE_EN=alloy

# ========================================
# LLM Configuration
# ========================================
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_KEY=your_api_key_here

# Force short replies on phone
LLM_MAX_TOKENS=40
LLM_TEMPERATURE_HI=0.3   # Lower for Hindi (more deterministic)
LLM_TEMPERATURE_EN=0.5   # Balanced for English

# ========================================
# Supabase KB Configuration
# ========================================
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_service_role_key
KB_SEMANTIC_SEARCH=true
KB_FALLBACK_ENABLED=true
KB_THRESHOLD_HI=0.6      # Lower threshold for Hindi matching
KB_THRESHOLD_EN=0.7      # Stricter for English

# ========================================
# Fast Path Configuration
# ========================================
FAST_PATH_ENABLED=true
GREETING_MODE=short      # or 'full' for detailed greeting
```

---

## Step 5: Deploy Supabase Setup

1. Go to your **Supabase Dashboard**
2. Click **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy the entire `supabase_setup.sql` file into the editor
5. Click **Run**
6. Wait for "success" message

---

## Step 6: Seed Your Knowledge Base

1. Make sure you have your `.env` configured with Supabase credentials
2. Run the seeding script:

```bash
node scripts/seedKnowledgeBase.js
```

Expected output:
```
═══════════════════════════════════════════
  DigeeSell Knowledge Base Seeding
═══════════════════════════════════════════

[1/12] Seeding: Company Overview...
✓ Seeded: Company Overview
[2/12] Seeding: SEO Services...
✓ Seeded: SEO Services
... (continues for all 12 chunks)

═══════════════════════════════════════════
  Seeding Complete
═══════════════════════════════════════════
✓ Successful: 12
✗ Failed: 0
Total: 12/12

✓ All chunks seeded successfully!
Your KB is now ready for semantic search.
```

---

## Step 7: Test the Fixes

### Test 1: Hindi Detection ✓

**Make a call and say:**
- `"Hindi mein baat karo"` (speak in Hindi)

**Expected:**
- Agent replies: `"Bilkul, Hindi mein baat karte hain. Aap bataiye."`
- Logs show: `useHindiMode=true`
- TTS voice is Indian/Hindi (sounds different from English)

### Test 2: Hinglish Reply ✓

**Make a call and say:**
- `"SEO package ke baare mein batao"` (tell me about SEO packages)

**Expected:**
- Agent replies in Roman-Hindi (English letters only): `"SEO ka package 15,000 rupees se shuru hota hai."`
- No Devanagari, no Urdu script
- Logs show: `useHindiMode=true`

### Test 3: Fast Replies ✓

**Make a call and say:**
- `"Hello"`

**Expected:**
- Agent replies instantly (< 2 seconds): `"Yes, go ahead — how can I help?"`
- Logs show: `✓ Fast path matched`
- No `querying LLM` log entry

### Test 4: KB Integration ✓

**Make a call and say:**
- `"Mujhe pricing batao"` (Tell me pricing)

**Expected:**
- Agent replies with pricing from KB: `"SEO 15,000 rupees se shuru, SMM 12,000 se."`
- Logs show: `KB context found`
- No error logs

---

## Troubleshooting

### Issue: Hindi still not detected

**Check:**
1. Language detection is being called: look for `useHindiMode=` in logs
2. Transcript is correct: check actual transcript before language detection
3. Keywords are in HINDI_KEYWORDS: add more keywords if needed

**Add debugging:**
```javascript
import { detectLanguageWithScore } from '../services/languageDetectionService.js';

const analysis = detectLanguageWithScore(text, language);
console.log('Language analysis:', JSON.stringify(analysis, null, 2));
```

### Issue: LLM replies in English even in Hindi mode

**Check:**
1. System prompt is being passed: verify `buildLLMParameters` in logs
2. Prompt actually contains Hindi instructions
3. LLM is receiving `max_tokens=40` constraint

**Fix:**
```javascript
// Add to LLM call for debugging
const llmParams = buildLLMParameters(useHindiMode, kbContext, text);
console.log('LLM params:', JSON.stringify(llmParams, null, 2));
```

### Issue: KB not found

**Check:**
1. Supabase RPC `match_documents` exists: run this in SQL Editor:
   ```sql
   SELECT routine_name FROM information_schema.routines 
   WHERE routine_name = 'match_documents';
   ```
2. Documents were seeded: run in SQL Editor:
   ```sql
   SELECT COUNT(*) FROM documents;
   ```
3. Embeddings are stored: run in SQL Editor:
   ```sql
   SELECT id, content, embedding FROM documents LIMIT 1;
   ```

### Issue: TTS not switching voice

**Check:**
1. `getTTSConfig` is being called
2. Right provider and voice ID are set in `.env`
3. ElevenLabs API key is valid

---

## Performance Checklist

After integration, your agent should:

- ✓ Detect Hindi in transcripts (within 100ms)
- ✓ Switch to Hindi TTS when speaking Hindi (~200ms)
- ✓ Reply to greetings in <2 seconds (fast path)
- ✓ Reply to service questions in <4 seconds (with KB)
- ✓ No repeated intros or hallucinated responses
- ✓ Roman-Hindi replies use only English letters

---

## Next Steps for Production

1. **Deepgram STT upgrade** (optional, 1–2 hours)
   - Better Hindi detection on 8kHz phone
   - Streaming reduces latency

2. **Stream TTS** (optional, 1–2 hours)
   - First 20 tokens to TTS while LLM finishes
   - User hears reply sooner

3. **Monitor & Iterate**
   - Save all call recordings for 1 week
   - Log transcript → normalized → language → reply
   - Identify new normalization rules needed

---

## Questions?

If you get stuck on any step, check:
1. `.env` variables are set correctly
2. All 3 new services are imported
3. Supabase SQL ran without errors
4. seedKnowledgeBase.js completed with 0 failures
