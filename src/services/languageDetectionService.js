/**
 * languageDetectionService.js
 * Language detection based on keyword matching (not Whisper language tag).
 *
 * Why: Whisper misclassifies Hindi as Polish/English on 8kHz phone audio.
 * Solution: Look for actual Hindi/Roman-Hindi words in the transcript.
 */

const HINDI_KEYWORDS = {
  // Speech control
  hindi: true, hinglish: true, english: true,
  // Common verbs
  baat: true, bolo: true, boliye: true, bologe: true, karogi: true,
  karoge: true, karo: true, kehte: true, sunna: true, suna: true,
  batao: true, bataya: true,
  // Questions
  kya: true, kaise: true, kaun: true, kahan: true, kab: true,
  // Pronouns & Articles
  maine: true, mujhe: true, mere: true, aap: true, tumhare: true, unhone: true,
  // Needs/Wants
  chahiye: true, chaahta: true, chaahti: true,
  // Adjectives/State
  hai: true, hain: true, hogi: true, ho: true, hoon: true, tha: true, the: true,
  // Location/Prepositional
  mein: true, baare: true, baarey: true, tak: true, se: true, ko: true,
  par: true, ke: true, ka: true, ki: true,
  // Negation
  nahi: true, mat: true,
  // Affirmation
  haan: true, ji: true, bilkul: true, theek: true,
  // Greetings
  namaste: true, namaskar: true, salaam: true, khuda: true, hafiz: true,
  // Numbers
  ek: true, do: true, teen: true, char: true, paanch: true,
  das: true, hazaar: true, lakh: true, crore: true,
  // Services/Business (DigeeSell context)
  seo: true, seva: true, sewa: true, paisa: true, paise: true,
  kharcha: true, daam: true, package: true, plan: true,
};

const URDU_SCRIPT_RANGES = [
  [0x0600, 0x06FF],
  [0x0750, 0x077F],
];

const DEVANAGARI_SCRIPT_RANGE = [0x0900, 0x097F];

/**
 * Returns 'hi' if Hindi detected, 'en' if English, 'mixed' if both.
 */
export function detectLanguageByKeywords(transcript) {
  if (!transcript || transcript.length === 0) return "unknown";

  const words = transcript
    .toLowerCase()
    .split(/[\s,.\!?;:()]+/)
    .filter((w) => w.length > 0);

  let hindiMatches = 0;
  let englishWordCount = 0;

  for (const word of words) {
    if (HINDI_KEYWORDS[word]) {
      hindiMatches++;
    } else if (word.length > 2 && /^[a-z]+$/.test(word)) {
      englishWordCount++;
    }
  }

  const totalWords = words.length;
  const hindiRatio = totalWords > 0 ? hindiMatches / totalWords : 0;

  if (hindiRatio >= 0.2 || hindiMatches >= 1) return "hi";
  if (englishWordCount > hindiMatches + 2) return "en";
  return totalWords > 0 ? "mixed" : "unknown";
}

export function containsIndianScript(transcript) {
  if (!transcript) return false;
  for (const char of transcript) {
    const code = char.charCodeAt(0);
    if (code >= DEVANAGARI_SCRIPT_RANGE[0] && code <= DEVANAGARI_SCRIPT_RANGE[1]) return true;
    for (const [start, end] of URDU_SCRIPT_RANGES) {
      if (code >= start && code <= end) return true;
    }
  }
  return false;
}

/**
 * Main function — returns true if should use Hindi mode.
 */
export function shouldUseHindiMode(transcript, whisperLanguageTag) {
  if (!transcript || transcript.length === 0) return false;

  const kw = detectLanguageByKeywords(transcript);
  if (kw === "hi") return true;

  if (containsIndianScript(transcript)) return true;

  if (whisperLanguageTag === "hi" || whisperLanguageTag === "ur") return true;

  return false;
}

export function detectLanguageWithScore(transcript, whisperLanguageTag) {
  const useHindiMode = shouldUseHindiMode(transcript, whisperLanguageTag);
  return {
    mode:            useHindiMode ? "hindi" : "english",
    keywordDetection: detectLanguageByKeywords(transcript),
    hasIndianScript: containsIndianScript(transcript),
    whisperTag:      whisperLanguageTag,
    confidence:      useHindiMode ? 0.9 : 0.5,
  };
}

export { HINDI_KEYWORDS };
