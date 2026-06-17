// FILE: src/services/languageDetectionService.js
// This is a NEW service file — add to your project

/**
 * Language detection based on keyword matching (not Whisper language tag)
 * Why: Whisper misclassifies Hindi as Polish/English on 8kHz phone audio
 * Solution: Look for actual Hindi/Roman-Hindi words in transcript
 */

const HINDI_KEYWORDS = {
  // Speech control
  'hindi': true,
  'hinglish': true,
  'english': true,
  
  // Common verbs
  'baat': true,      // talk
  'bolo': true,      // speak
  'boliye': true,    // speak (formal)
  'bologe': true,    // will speak
  'karogi': true,    // will do
  'karoge': true,    // will do
  'karo': true,      // do
  'kehte': true,     // called
  'sunna': true,     // to hear
  'suna': true,      // heard
  'batao': true,     // tell
  'bataya': true,    // told
  
  // Questions
  'kya': true,       // what/is
  'kaise': true,     // how
  'kaun': true,      // who
  'kahan': true,     // where
  'kab': true,       // when
  
  // Pronouns & Articles
  'maine': true,     // I (past)
  'mujhe': true,     // to me
  'mere': true,      // my
  'aap': true,       // you (formal)
  'tumhare': true,   // your (informal)
  'unhone': true,    // they (past)
  
  // Needs/Wants
  'chahiye': true,   // need/want
  'chaahta': true,   // want (masculine)
  'chaahti': true,   // want (feminine)
  
  // Adjectives/State
  'hai': true,       // is
  'hain': true,      // are
  'hogi': true,      // will be
  'ho': true,        // are
  'hoon': true,      // am
  'tha': true,       // was
  'the': true,       // were
  'ho': true,        // are
  
  // Location/Prepositional
  'mein': true,      // in
  'baare': true,     // about
  'baarey': true,    // about
  'tak': true,       // until
  'se': true,        // from
  'ko': true,        // to (object marker)
  'par': true,       // on
  'ke': true,        // of
  'ka': true,        // of
  'ki': true,        // of (feminine)
  
  // Negation
  'nahi': true,      // no
  'nahi': true,      // not
  'mat': true,       // don't
  
  // Affirmation
  'haan': true,      // yes
  'ji': true,        // yes (formal)
  'bilkul': true,    // absolutely
  'theek': true,     // ok
  
  // Greetings
  'namaste': true,
  'namaskar': true,
  'salaam': true,
  'khuda': true,
  'hafiz': true,
  
  // Numbers (Hindi digits in words)
  'ek': true,        // one
  'do': true,        // two
  'teen': true,      // three
  'char': true,      // four
  'paanch': true,    // five
  'das': true,       // ten
  'hazaar': true,    // thousand
  'lakh': true,      // hundred thousand
  'crore': true,     // ten million
  
  // Services/Business (DigeeSell context)
  'seo': true,
  'seva': true,      // service
  'sewa': true,      // service
  'paisa': true,     // money
  'paise': true,     // rupees
  'kharcha': true,   // cost
  'daam': true,      // price
  'package': true,
  'plan': true,
};

const URDU_SCRIPT_RANGES = [
  [0x0600, 0x06FF],  // Arabic
  [0x0750, 0x077F],  // Arabic Supplement
];

const DEVANAGARI_SCRIPT_RANGE = [0x0900, 0x097F];

/**
 * Check if text contains Hindi/Roman-Hindi keywords
 * Returns: 'hi' if Hindi detected, 'en' if English, 'mixed' if both
 */
function detectLanguageByKeywords(transcript) {
  if (!transcript || transcript.length === 0) {
    return 'unknown';
  }
  
  const words = transcript.toLowerCase()
    .split(/[\s,.\!?;:()]+/)
    .filter(w => w.length > 0);
  
  let hindiMatches = 0;
  let englishWordCount = 0;
  
  for (const word of words) {
    if (HINDI_KEYWORDS[word]) {
      hindiMatches++;
    } else if (word.length > 2 && /^[a-z]+$/.test(word)) {
      // English word (3+ letters, all ASCII)
      englishWordCount++;
    }
  }
  
  const totalWords = words.length;
  const hindiRatio = totalWords > 0 ? hindiMatches / totalWords : 0;
  
  // If 20%+ of words are Hindi keywords → Hindi mode
  if (hindiRatio >= 0.2 || hindiMatches >= 1) {
    return 'hi';
  }
  
  // If mostly English → English mode
  if (englishWordCount > hindiMatches + 2) {
    return 'en';
  }
  
  // Mixed or unclear
  return totalWords > 0 ? 'mixed' : 'unknown';
}

/**
 * Check if transcript contains Urdu/Devanagari script
 * If yes, also treat as Hindi mode
 */
function containsIndianScript(transcript) {
  if (!transcript) return false;
  
  for (const char of transcript) {
    const code = char.charCodeAt(0);
    
    // Check Devanagari (नमस्ते)
    if (code >= DEVANAGARI_SCRIPT_RANGE[0] && code <= DEVANAGARI_SCRIPT_RANGE[1]) {
      return true;
    }
    
    // Check Urdu/Arabic (ہیلو)
    for (const [start, end] of URDU_SCRIPT_RANGES) {
      if (code >= start && code <= end) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Main detection function
 * Returns true if should use Hindi mode
 */
function shouldUseHindiMode(transcript, whisperLanguageTag) {
  if (!transcript || transcript.length === 0) {
    return false;
  }
  
  // Priority 1: Explicit Hindi keywords
  const keywordDetection = detectLanguageByKeywords(transcript);
  if (keywordDetection === 'hi') {
    return true;
  }
  
  // Priority 2: Indian scripts (Devanagari or Urdu)
  if (containsIndianScript(transcript)) {
    return true;
  }
  
  // Priority 3: Whisper language tag (fallback, unreliable on phone)
  // But don't trust it alone — only if combined with other signals
  if (whisperLanguageTag === 'hi' || whisperLanguageTag === 'ur') {
    return true;
  }
  
  // Default to English
  return false;
}

/**
 * Get language mode with confidence score
 * Useful for logging/debugging
 */
function detectLanguageWithScore(transcript, whisperLanguageTag) {
  const useHindiMode = shouldUseHindiMode(transcript, whisperLanguageTag);
  
  const keywordDetection = detectLanguageByKeywords(transcript);
  const hasIndianScript = containsIndianScript(transcript);
  
  return {
    mode: useHindiMode ? 'hindi' : 'english',
    keywordDetection,
    hasIndianScript,
    whisperTag: whisperLanguageTag,
    confidence: useHindiMode ? 0.9 : 0.5, // Adjust as needed
  };
}

module.exports = {
  shouldUseHindiMode,
  detectLanguageByKeywords,
  containsIndianScript,
  detectLanguageWithScore,
  HINDI_KEYWORDS,
};
