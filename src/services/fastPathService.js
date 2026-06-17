/**
 * fastPathService.js
 * Instant replies without LLM for greetings, language switches, etc.
 * Cuts response time from ~2-4 seconds to <0.5 seconds for common phrases.
 */

export const FAST_PATHS_ENGLISH = {
  hello: "Yes, go ahead — how can I help?",
  hi: "Hi! How can I assist you?",
  hey: "Hey there! What can I help with?",
  "good morning":   "Good morning! How can I help?",
  "good afternoon": "Good afternoon! What can I do for you?",
  "good evening":   "Good evening! How can I help?",
  thanks:     "Thank you! Is there anything else I can help with?",
  "thank you": "You're welcome! Any other questions?",
  ok:    "Great! Anything else?",
  okay: "Perfect! Can I help with anything else?",
  bye:      "Goodbye! Looking forward to working with you!",
  goodbye:  "Goodbye! Have a great day!",
  "see you":   "See you later!",
  "take care": "You too! Take care!",
  english:         "Sure! I'll continue in English.",
  "english please": "Absolutely! Speaking in English.",
  "english mein":   "Sure, continuing in English.",
  sorry:  "No problem! Can you say that again?",
  huh:    "Sorry, could you repeat that?",
  what:   "Could you say that again, please?",
  repeat: "Of course! Can you repeat your question?",
};

export const FAST_PATHS_HINDI = {
  namaste:  "Namaste! Aap bataiye, kya chahiye?",
  namaskar: "Namaskar! Aap kaise hain?",
  hello: "Ji, boliye!",
  hi:    "Haan, suno meri baat!",
  haan:  "Ji, aap boliye!",
  thanks:      "Aapka shukriya! Aur kuch puchna hai?",
  dhanyavaad:  "Khushi hui! Aur kuch?",
  theek:       "Bilkul! Aur kya?",
  "theek hai": "Badiya! Aur bataiye!",
  bye:     "Phir milenge! Khuda hafiz!",
  goodbye: "Aapka shukriya! Phir milenge!",
  bas:   "Theek hai! Phir baat karenge!",
  chalo: "Bilkul! Phir milenge!",
  hindi:             "Bilkul! Hindi mein baat karte hain. Aap bataiye.",
  "hindi mein":      "Bilkul, Hindi mein baat karte hain!",
  "hindi baat karo": "Ji, Hindi mein baat karte hain. Aap boliye.",
  hinglish:           "Bilkul! Hinglish mein jawab dunga.",
  "hindi me baat karo": "Bilkul, Hindi mein baat karte hain!",
  kya:              "Maaf kariye, ek baar phir boliye?",
  "samajh nahi aaya": "Aap ek baar aur boliye, please?",
  "samajh nahi":    "Aap clear mein boliye?",
  repeat:   "Bilkul! Ek baar aur boliye?",
  "phir se": "Ek baar aur bataiye!",
  namskar: "Namaste! Aap kaise hain?",
};

/**
 * Check if transcript matches a fast path.
 * Returns the pre-written reply if found, null otherwise.
 */
export function checkFastPath(transcript, useHindiMode) {
  if (!transcript || transcript.length === 0) return null;

  const normalized = transcript
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:()]+/g, "");

  const fastPaths = useHindiMode ? FAST_PATHS_HINDI : FAST_PATHS_ENGLISH;

  if (fastPaths[normalized]) return fastPaths[normalized];

  for (const [key, value] of Object.entries(fastPaths)) {
    if (normalized.includes(key) && key.length > 2) return value;
  }

  return null;
}

export function isFastPathIntent(transcript, useHindiMode) {
  return checkFastPath(transcript, useHindiMode) !== null;
}

export function getWaitingMessage(useHindiMode) {
  return useHindiMode ? "Ek pal..." : "One moment...";
}

export function mergeFastPaths(customPaths, useHindiMode) {
  const defaults = useHindiMode ? FAST_PATHS_HINDI : FAST_PATHS_ENGLISH;
  return { ...defaults, ...customPaths };
}

/**
 * Determine if this looks like a real query vs. short noise.
 * Returns { isQuery: boolean, confidence: number, reason: string }
 */
export function assessIfRealQuery(transcript, useHindiMode) {
  if (!transcript || transcript.length === 0) {
    return { isQuery: false, confidence: 0, reason: "empty_transcript" };
  }

  if (transcript.split(/\s+/).length < 2) {
    return { isQuery: false, confidence: 0.3, reason: "too_short" };
  }

  if (isFastPathIntent(transcript, useHindiMode)) {
    return { isQuery: false, confidence: 1.0, reason: "greeting_or_control" };
  }

  const hasQuestionMarks = /\?/.test(transcript);
  const questionWords = useHindiMode
    ? ["kya", "kaise", "kaun", "kahan", "kab"]
    : ["what", "how", "who", "where", "when", "which", "why"];

  if (hasQuestionMarks || questionWords.some((q) => transcript.toLowerCase().includes(q))) {
    return { isQuery: true, confidence: 0.9, reason: "has_question_marker" };
  }

  const queryKeywords = useHindiMode
    ? ["seo", "google", "package", "price", "cost", "help", "chahiye", "batao", "service"]
    : ["seo", "google", "package", "price", "cost", "help", "want", "need", "service"];

  if (queryKeywords.some((k) => transcript.toLowerCase().includes(k))) {
    return { isQuery: true, confidence: 0.8, reason: "has_query_keyword" };
  }

  if (transcript.split(/\s+/).length > 3) {
    return { isQuery: true, confidence: 0.6, reason: "medium_length" };
  }

  return { isQuery: false, confidence: 0.4, reason: "unclear" };
}
