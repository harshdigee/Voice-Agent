# DigeeSell Voice Agent Debug Report

Date: 2026-06-17

## Current Goal

Build a production-level phone call agent for DigeeSell that can:

- Answer Vobiz phone calls.
- Listen to caller speech through the phone line.
- Understand English, Hindi, and Roman-Hindi/Hinglish.
- Reply quickly.
- Reply in Hindi/Roman-Hindi when the caller speaks Hindi.
- Use DigeeSell knowledge base data for service and pricing questions.

The main unresolved user-facing complaint was: **the agent is not listening to simple Hindi sentences even when the caller speaks loudly.**

## Tech Stack Used

- Runtime: Node.js with ES modules.
- Server: Express.
- WebSocket: `ws`.
- Telephony: Vobiz bidirectional media stream.
- Inbound audio format: 8 kHz G.711 mu-law.
- Outbound audio format: 8 kHz G.711 mu-law.
- STT: Groq Whisper, currently `whisper-large-v3-turbo`.
- English TTS: Groq Orpheus, `canopylabs/orpheus-v1-english`, voice `hannah`.
- Hindi/Hinglish TTS: OpenAI TTS, `tts-1`, voice `nova`.
- LLM/Agent: OpenAI `gpt-4o-mini`, with Groq LLaMA fallback available.
- Knowledge Base: Supabase `documents` table, OpenAI `text-embedding-3-small` embeddings, inline DigeeSell KB fallback.
- Environment config: `.env`.

## Main Files Involved

- `src/server.js`: starts HTTP server and WebSocket server.
- `src/routes/vobiz.js`: Vobiz HTTP routes.
- `src/controllers/vobizStreamController.js`: phone stream controller, VAD, STT -> agent -> TTS pipeline.
- `src/services/groqService.js`: Groq Whisper STT, OpenAI/Groq LLM, TTS.
- `src/services/vadService.js`: energy-based voice activity detection.
- `src/services/audioUtils.js`: mu-law, PCM, WAV, resampling utilities.
- `src/services/knowledge.js`: Supabase and fallback KB search.
- `src/data/digeesellKb.js`: local DigeeSell KB chunks.
- `scripts/seedKnowledge.js`: Supabase KB seeding script.
- `supabase_setup.sql`: Supabase vector/RPC setup.

## What Was Changed

1. Short testing greeting

   The greeting was changed from a long customer-care intro to:

   `Hello, I am Riya.`

   This is controlled by:

   `GREETING_MODE=short`

   The full greeting can be restored later with:

   `GREETING_MODE=full`

2. STT model changed

   STT was changed to:

   `GROQ_STT_MODEL=whisper-large-v3-turbo`

   This is faster than the full model and better for reducing phone-call delay during testing.

3. Whisper prompt removed

   Earlier, Whisper had a domain prompt mentioning DigeeSell, SEO, Google Ads, etc. On quiet or echo-heavy audio, Whisper was repeating prompt-like phrases back into the transcript.

   Examples seen earlier:

   - `The caller speaks Hindi or English.`
   - `Thank you for watching.`
   - `DigeeSell, SEO, Google Ads...`

   The prompt was removed because it caused hallucinated transcripts.

4. Hallucination filter fixed

   A previous filter accidentally treated valid service words like `SEO` as hallucination/prompt echo.

   Real issue found in logs:

   `I want to know about your SEO packages.` was discarded.

   This was wrong. The filter was changed to only block exact known fake phrases, not real business questions.

5. Hindi/Roman-Hindi normalization added

   The latest transcript showed Whisper hearing Hindi/Roman-Hindi incorrectly:

   - Caller likely asked about SEO package, but transcript became:
     `as seal package given in button.`
   - Caller likely asked Hindi language question, but transcript became:
     `India Vat Karogi`
   - Another Hindi utterance was detected as Polish:
     `Jak żyją?`

   Code now normalizes common phone STT mistakes:

   - `India Vat Karogi` -> `Hindi baat karogi`
   - `Hindi what/bat/vat karogi` -> `Hindi baat karogi`
   - `Jak zyja` / `Jak żyją` -> `kya chahiye`
   - `as seal package...` -> `SEO package ke baare mein batao`

6. Roman-Hindi language detection improved

   The app no longer relies only on Whisper language tags.

   Before:

   - Whisper returned `english`.
   - App replied in English.

   Now text containing Roman-Hindi words is treated as Hindi:

   - `hindi`
   - `baat`
   - `karogi`
   - `karoge`
   - `kya`
   - `kaise`
   - `hai`
   - `mujhe`
   - `chahiye`
   - `batao`
   - `baare`
   - `mein`
   - `haan`
   - `nahi`
   - `namaste`

7. Non-Indian language discard made safer

   Before, if Whisper detected a language like Polish, the app discarded the utterance immediately.

   This broke Hindi because Hindi phone audio was sometimes detected as Polish.

   Now the app first normalizes the text and checks whether the normalized result looks Hindi. If yes, it keeps it and routes the reply through Hindi mode.

8. Fast hello path

   For simple greetings like `hello`, `hi`, or `namaste`, the app does not call the LLM.

   It immediately replies:

   - English: `Yes, go ahead — how can I help?`
   - Hindi mode: `Ji, boliye — main sun rahi hoon.`

9. Single TTS per agent turn

   The previous implementation generated TTS sentence by sentence. This created multiple audio chunks and more delay/cost.

   It now generates one full short reply and sends one TTS audio response per turn.

10. Knowledge base seeded

   A DigeeSell KB was created and seeded into Supabase with 10 chunks:

   - company
   - SEO
   - Google Ads
   - Meta Ads
   - social media
   - website
   - WhatsApp
   - onboarding
   - pricing
   - contact

   Inline fallback KB is also available if Supabase semantic search fails.

## Real Issues Seen In Your Calls

1. Hindi was not cleanly transcribed

   Your Hindi/Roman-Hindi speech was not coming through as Hindi text.

   Real transcript examples:

   - `India Vat Karogi`
   - `as seal package given in button.`
   - `Jak żyją?`

   This is why the agent replied incorrectly or did not reply in Hindi.

2. Whisper language detection was unreliable on phone audio

   The app saw:

   - `whisper=english`
   - `language=polish`

   even when the caller was speaking Hindi/Roman-Hindi.

   This is a phone-audio/STT problem, but the code was also too strict and handled it badly.

3. The code discarded useful audio

   The earlier code discarded anything with a non-Indian Whisper language tag. That caused actual Hindi-like sounds to be dropped.

4. The app replied in English because the app classified the text as English

   Example:

   `India Vat Karogi`

   The old logic did not recognize this as `Hindi baat karogi`, so it replied in English.

5. Repeated intro problem

   When the caller said hello again, the LLM sometimes repeated the full intro. This was bad for user experience and call cost.

6. Delay problem

   Delay came from:

   - STT request
   - LLM request
   - multiple TTS requests
   - long generated replies
   - phone playback checkpoints

   The code now uses shorter greeting, smaller replies, faster STT model, and one TTS call per turn.

7. Knowledge base RPC missing

   Supabase logs showed:

   `match_documents RPC not available`

   The agent falls back to text search and inline KB, but semantic search will be better after running `supabase_setup.sql` in Supabase SQL Editor.

## Why Hindi Was Not Working

The short answer:

**The app was receiving your Hindi/Roman-Hindi through an 8 kHz phone stream, Whisper was converting it into bad English/European-looking text, and then the app logic trusted that bad text too much.**

For example:

- You expected: `Hindi baat karogi?`
- Whisper returned: `India Vat Karogi`
- Old app decision: English sentence
- Old agent reply: English VAT answer

So the problem was not only your phone microphone. The code also needed Hindi-aware correction after STT.

## Current State After Fix

The server is configured for:

- Short greeting.
- Faster Groq Whisper turbo STT.
- No Whisper prompt.
- Hindi/Roman-Hindi normalization.
- Hindi mode when Roman-Hindi words are detected.
- OpenAI Hindi/Hinglish TTS for Hindi mode.
- Single TTS response per turn.
- Supabase KB seeded.
- Inline KB fallback.

## Latest Call Finding: 2026-06-17 08:55 UTC

New call log showed:

- `Hindi me baat keroe.` was correctly inferred as Hindi and replied using OpenAI Hindi TTS.
- The next sentence was transcribed as Urdu script:
  `مجھے گوگل ایڈز کے بارے بتاؤں`
- The old code classified Urdu-script output as English because it only checked Devanagari and Roman-Hindi words.
- The LLM then generated a long Urdu-script reply after the call had already closed, so the caller did not hear it.

Fix added:

- Arabic/Urdu script from Whisper is now treated as Hindi mode.
- Hindi prompt now explicitly says: reply only in Romanised Hindi/Hinglish using English letters, never Urdu/Arabic or Devanagari script.
- `Hindi me baat keroe` is normalized to `Hindi mein baat karo`.
- Asking to speak Hindi now uses a direct fast response without KB or LLM delay:
  `Bilkul, Hindi mein baat karte hain. Aap bataiye.`
- The controller now checks whether the WebSocket is still open before speaking after LLM generation.
- Supabase semantic-search failure is cached so the app stops wasting time on missing `match_documents` every turn.

Expected behavior for test phrases:

- Caller: `hello`
  - Agent: `Yes, go ahead — how can I help?`

- Caller: `Hindi baat karogi`
  - Agent should switch to Hindi/Roman-Hindi.

- Caller: `SEO package ke baare mein batao`
  - Agent should reply in Roman-Hindi about SEO packages.

- Caller misheard as `India Vat Karogi`
  - App normalizes to `Hindi baat karogi`.

- Caller misheard as `as seal package given in button`
  - App normalizes to `SEO package ke baare mein batao`.

## What Still Needs Attention For Production

1. Use a real streaming STT provider for phone calls

   Groq Whisper file-based STT is workable for testing, but it is not the permanent production solution for Hindi phone calls. Production voice agents usually use streaming STT with partial transcripts, endpointing, and telephony-tuned models.

   Better production options:

   - Deepgram streaming STT
   - AssemblyAI streaming STT
   - Google Speech-to-Text streaming
   - Azure Speech

   These generally perform better than batch Whisper on 8 kHz phone calls.

   Recommendation for this project:

   - Use Deepgram or AssemblyAI streaming STT for Vobiz media frames.
   - Keep OpenAI/Groq as the LLM.
   - Keep TTS short and stream audio back as soon as a short answer is ready.
   - Save every caller utterance WAV while testing so STT failures can be audited.

2. Add real barge-in with partial STT

   Current barge-in is based on VAD energy. A production agent should use streaming STT partials to know whether caller speech is real speech or echo.

3. Add test audio recordings

   The best next debugging step is to save each raw caller utterance as WAV during testing, then compare:

   - what was actually received
   - what Whisper returned
   - what the app normalized

4. Run Supabase SQL setup

   Run `supabase_setup.sql` in Supabase SQL Editor to create `match_documents`.

5. Tune Hindi phrases based on more real transcripts

   The normalizer now handles the real mistakes seen so far. More test calls will reveal more phone-specific mishearings.

## Test Script To Use Now

For the next call, say these exact sentences with a 1 second gap after the greeting:

1. `Hello`
2. `Hindi baat karogi`
3. `SEO package ke baare mein batao`
4. `Mujhe Google Ads ke baare mein batao`

Expected:

- The transcript should not say VAT for `Hindi baat karogi`.
- The agent should reply in Roman-Hindi after phrase 2.
- The SEO question should not be discarded.
- The agent should not repeat the long intro.

## Important Notes

This report intentionally does not include API keys, auth tokens, or Supabase service keys.

The most important code issue found today was: **Hindi/Roman-Hindi phone STT output was being misclassified and mishandled after Whisper.**

The fix added today is a practical correction layer for your actual transcripts. For true production quality, replace batch Whisper STT with a streaming telephony-grade STT provider.
