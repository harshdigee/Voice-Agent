# Real Issue Found: Whisper Hindi → Spanish Hallucination

## Aapka actual log:

```
[WARN] [STT] Hallucinated language "spanish" — discarding: "Ahora que ha sido"
[WARN] [STT] Hallucinated language "spanish" — discarding: "que sigo."
[WARN] [STT] Hallucinated language "spanish" — discarding: "que sí, un..."
[WARN] [STT] Hallucinated language "spanish" — discarding: "que sí juro."
```

## Kya ho raha hai (Root Cause)

1. Aap Hindi bol rahe ho phone pe
2. 8kHz mu-law phone audio + no language hint → Whisper confused ho jaata hai
3. Whisper Hindi audio ko galat sunke **Spanish-sounding fake text** bana deta hai
   (ye real transcription nahi hai — pure hallucination)
4. Aapka existing hallucination filter (jo already code mein hai) sahi se discard kar raha hai
5. **Lekin iska matlab: real Hindi speech kabhi LLM tak pahunchti hi nahi**

Whisper ke paas `language` parameter nahi diya gaya, isliye wo guess karta hai — aur 8kHz noisy phone audio pe Hindi → Spanish guess karna common Whisper issue hai (donon mein similar phonemes/sounds hote hain jab audio quality kharab ho).

## ElevenLabs Ka Isse Koi Lena-Dena Nahi

Confirm kar deta hoon — **ye STT (Groq Whisper) ka issue hai, TTS (ElevenLabs/OpenAI) ka nahi.**

```
Caller bolta hai → [STT: Groq Whisper] → ❌ FAILS HERE (Spanish hallucination)
                                              ↓ (never reaches this)
                   [Language Detection] → [LLM] → [TTS: ElevenLabs/OpenAI]
```

ElevenLabs credits na hone se sirf TTS voice quality affect hoti hai (fallback OpenAI nova use hoga) — but agar STT hi Hindi sun nahi pa raha, to TTS tak baat hi nahi pahunchegi.

---

## Fix #1: Whisper Ko Language Hint Do (Most Important)

Groq Whisper API ko `language` parameter bhejo taaki wo guess na kare.

**Find this in `groqService.js`** (jahan Whisper API call hota hai):

```javascript
// PEHLE (current code - likely yeh hai)
const transcription = await groq.audio.transcriptions.create({
  file: audioFile,
  model: "whisper-large-v3-turbo",
  response_format: "verbose_json",
});
```

**Replace with:**

```javascript
// BAAD (language hint diya)
const transcription = await groq.audio.transcriptions.create({
  file: audioFile,
  model: "whisper-large-v3-turbo",
  response_format: "verbose_json",
  // Don't force a single language — but bias toward Hindi/English only
  // Groq Whisper doesn't support multi-language hints directly,
  // so we use prompt instead to bias the model:
  prompt: "यह कॉल हिंदी या अंग्रेजी में है। This call is in Hindi or English.",
  temperature: 0.0, // Reduce randomness/hallucination
});
```

**Important:** Tumhare debug report mein already mention tha ki prompt hata diya gaya tha (kyunki wo prompt-echo hallucinations create kar raha tha — `"DigeeSell, SEO, Google Ads..."` repeat ho rahi thi). 

**Better approach:** Sirf language bias do, business words mat do:

```javascript
prompt: "Hindi or English conversation.",
temperature: 0.0,
```

Yeh business-word hallucination nahi banayega (chota, generic prompt hai) lekin Whisper ko Spanish guess karne se rokega.

---

## Fix #2: Hallucination Filter Ko Smarter Banao

Abhi tumhara filter language tag dekh ke discard kar raha hai (`language === "spanish"` → discard). Ye galat strategy hai kyunki:

- Real Spanish caller kabhi nahi aayega (DigeeSell India/UAE based hai)
- Lekin Hindi audio bhi misclassify ho sakta hai as Spanish/Polish/etc.

**Better strategy: Sirf known fake phrases discard karo, language tag pe trust mat karo**

Find your hallucination filter (likely in `groqService.js` ya `vobizStreamController.js`):

```javascript
// PEHLE (language-based discard — galat approach)
if (transcription.language === 'spanish' || transcription.language === 'polish') {
  console.warn(`[STT] Hallucinated language "${transcription.language}" — discarding: "${text}"`);
  return null;
}
```

**Replace with:**

```javascript
// BAAD (content-based discard — sahi approach)
const KNOWN_HALLUCINATIONS = [
  /^ahora que/i,
  /^que s[ií]/i,
  /^que sigo/i,
  /thank you for watching/i,
  /the caller speaks/i,
  /digeesell.*seo.*google ads/i,
  /jak.*zyj/i,
];

const isHallucination = KNOWN_HALLUCINATIONS.some(pattern => pattern.test(text));

if (isHallucination) {
  console.warn(`[STT] Known hallucination pattern — discarding: "${text}"`);
  return null;
}

// Don't discard based on language tag alone — 
// instead, ALWAYS try Hindi keyword detection regardless of Whisper's language guess
const useHindiMode = shouldUseHindiMode(text, transcription.language);
console.log(`[STT] whisper_lang=${transcription.language} text="${text}" useHindiMode=${useHindiMode}`);
```

**Why this works:** Ab chahe Whisper Spanish bole ya Polish bole, hum sirf actual transcript text dekhte hain. Agar usme Hindi keywords hain (jo abhi nahi aa rahe kyunki text hi fake hai), to Hindi mode activate hoga. Agar text hi garbage hai (matched against known hallucination patterns), tabhi discard hoga.

---

## Fix #3: VAD / Audio Quality Check (Optional but Helps)

Agar caller dheere bol raha hai ya background noise hai, Whisper zyada hallucinate karta hai. Check karo VAD threshold:

```javascript
// vadService.js mein, energy threshold check karo
// Agar audio bahut quiet hai, to STT ko bhejo hi mat — empty transcription milegi
const MIN_ENERGY_THRESHOLD = 500; // Adjust based on testing

if (audioEnergy < MIN_ENERGY_THRESHOLD) {
  console.log('[VAD] Audio too quiet, skipping STT call');
  return;
}
```

---

## Test Karne Ke Liye

Fix lagane ke baad, phone pe clearly bolo (loud, clear, thoda paas mic ke):

```
Test 1: "Hello"
Expected log: whisper_lang=english text="hello" useHindiMode=false

Test 2: "Hindi mein baat karo"
Expected log: whisper_lang=??? text="Hindi mein baat karo" useHindiMode=true
(language tag chahe kuch bhi ho, keyword detection se Hindi pakड़ jayega)

Test 3: "Kaise ho aap"
Expected log: whisper_lang=??? text="Kaise ho aap" useHindiMode=true
```

Agar abhi bhi Spanish jaisa hallucination aata hai, to:
1. Phone signal/connection check karo (weak signal = zyada noise = zyada hallucination)
2. Loudly aur clearly bolo, normal phone call ki tarah
3. `temperature: 0.0` set hai ya nahi confirm karo (randomness kam karta hai)

---

## Summary — Seedha Jawab

**Q: ElevenLabs paid nahi hai to STT/TTS bilkul kaam nahi karega?**

**A: Nahi bhai.** 
- STT (Groq Whisper) — ElevenLabs se koi connection nahi, alag se kaam karta hai
- TTS English — Groq Orpheus se already chal raha hai, free hai
- TTS Hindi — ElevenLabs credits nahi hain to automatically OpenAI TTS (nova) pe fallback ho jaata hai, wo bhi chalta hai

**Asli problem:** Tumhari Hindi speech Whisper STT level pe hi Spanish samajh ke discard ho rahi hai — ye ElevenLabs ka issue nahi, Groq Whisper ka language-detection issue hai. Fix #1 aur #2 lagao, phir Hindi properly detect hoga.

**ElevenLabs sirf Hindi voice ki QUALITY better banata hai** (zyada natural sounding) — lekin uske bina bhi sab kaam karega, bas OpenAI ki nova voice use hogi jo thodi robotic lagti hai.
