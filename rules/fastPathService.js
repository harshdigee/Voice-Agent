// FILE: src/services/fastPathService.js
// Instant replies without LLM for greetings, language switches, etc.

const FAST_PATHS_ENGLISH = {
  // Greetings
  'hello': 'Yes, go ahead — how can I help?',
  'hi': 'Hi! How can I assist you?',
  'hey': 'Hey there! What can I help with?',
  'good morning': 'Good morning! How can I help?',
  'good afternoon': 'Good afternoon! What can I do for you?',
  'good evening': 'Good evening! How can I help?',
  
  // Affirmation
  'thanks': 'Thank you! Is there anything else I can help with?',
  'thank you': 'You\'re welcome! Any other questions?',
  'ok': 'Great! Anything else?',
  'okay': 'Perfect! Can I help with anything else?',
  
  // Closing
  'bye': 'Goodbye! Looking forward to working with you!',
  'goodbye': 'Goodbye! Have a great day!',
  'see you': 'See you later!',
  'take care': 'You too! Take care!',
  
  // Language preference
  'english': 'Sure! I\'ll continue in English.',
  'english please': 'Absolutely! Speaking in English.',
  'english mein': 'Sure, continuing in English.',
  
  // Unclear audio
  'sorry': 'No problem! Can you say that again?',
  'huh': 'Sorry, could you repeat that?',
  'what': 'Could you say that again, please?',
  'repeat': 'Of course! Can you repeat your question?',
};

const FAST_PATHS_HINDI = {
  // Greetings
  'namaste': 'Namaste! Aap bataiye, kya chahiye?', // Hello! What do you need?
  'namaskar': 'Namaskar! Aap kaise hain?', // Hello! How are you?
  'hello': 'Ji, boliye!', // Yes, go ahead!
  'hi': 'Haan, suno meri baat!', // Yes, I'm listening!
  'haan': 'Ji, aap boliye!', // Yes, please continue!
  
  // Affirmation
  'thanks': 'Aapka shukriya! Aur kuch puchna hai?', // Thanks! Anything else?
  'dhanyavaad': 'Khushi hui! Aur kuch?', // Glad to help! Anything else?
  'theek': 'Bilkul! Aur kya?', // Perfect! What else?
  'theek hai': 'Badiya! Aur bataiye!', // Good! Tell me more!
  
  // Closing
  'bye': 'Phir milenge! Khuda hafiz!', // See you later! Goodbye!
  'goodbye': 'Aapka shukriya! Phir milenge!', // Thanks! See you later!
  'bas': 'Theek hai! Phir baat karenge!', // OK! Talk later!
  'chalo': 'Bilkul! Phir milenge!', // Sure! See you later!
  
  // Language preference
  'hindi': 'Bilkul! Hindi mein baat karte hain. Aap bataiye.', // Sure! Let's talk in Hindi. You tell me.
  'hindi mein': 'Bilkul, Hindi mein baat karte hain!', // Sure, let's talk in Hindi!
  'hindi baat karo': 'Ji, Hindi mein baat karte hain. Aap boliye.', // Yes, let's talk in Hindi. You speak.
  'hinglish': 'Bilkul! Hinglish mein jawab dunga.', // Sure! I'll reply in Hinglish.
  'hindi me baat karo': 'Bilkul, Hindi mein baat karte hain!', // Sure, let's talk in Hindi!
  
  // Unclear audio
  'kya': 'Maaf kariye, ek baar phir boliye?', // Sorry, say that again?
  'samajh nahi aaya': 'Aap ek baar aur boliye, please?', // Say it again, please?
  'samajh nahi': 'Aap clear mein boliye?', // Speak clearly, please?
  'repeat': 'Bilkul! Ek baar aur boliye?', // Sure! Say it again?
  'phir se': 'Ek baar aur bataiye!', // Tell me again!
  
  // Common questions - no LLM needed
  'namskar': 'Namaste! Aap kaise hain?', // Greetings!
};

/**
 * Check if transcript matches a fast path
 * Returns reply if found, null otherwise
 */
function checkFastPath(transcript, useHindiMode) {
  if (!transcript || transcript.length === 0) {
    return null;
  }
  
  // Normalize: lowercase, trim, remove punctuation
  const normalized = transcript
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:()]+/g, '');
  
  const fastPaths = useHindiMode ? FAST_PATHS_HINDI : FAST_PATHS_ENGLISH;
  
  // Exact match (fastest)
  if (fastPaths[normalized]) {
    return fastPaths[normalized];
  }
  
  // Partial match (if transcript contains a fast path key)
  for (const [key, value] of Object.entries(fastPaths)) {
    // For short transcripts, do exact substring match
    if (normalized.includes(key) && key.length > 2) {
      return value;
    }
  }
  
  return null;
}

/**
 * Check if this is a greeting/language-switch that needs immediate reply
 * Used to decide whether to query LLM or just reply immediately
 */
function isFastPathIntent(transcript, useHindiMode) {
  const fastPathReply = checkFastPath(transcript, useHindiMode);
  return fastPathReply !== null;
}

/**
 * Get a "thinking" or holding message for slightly longer processing
 * (optional, for when STT takes longer than expected)
 */
function getWaitingMessage(useHindiMode) {
  if (useHindiMode) {
    return 'Ek pal...'; // One moment...
  } else {
    return 'One moment...';
  }
}

/**
 * Merge custom fast paths with default ones
 * Allows per-client customization
 */
function mergeFastPaths(customPaths, useHindiMode) {
  const defaults = useHindiMode ? FAST_PATHS_HINDI : FAST_PATHS_ENGLISH;
  return { ...defaults, ...customPaths };
}

/**
 * Determine confidence that this is actually a query vs. noise
 * Returns { isQuery: boolean, confidence: number (0-1), reason: string }
 */
function assessIfRealQuery(transcript, useHindiMode) {
  if (!transcript || transcript.length === 0) {
    return { isQuery: false, confidence: 0, reason: 'empty_transcript' };
  }
  
  // Very short = likely noise
  if (transcript.split(/\s+/).length < 2) {
    return { isQuery: false, confidence: 0.3, reason: 'too_short' };
  }
  
  // Is it a fast path?
  const isFastPath = isFastPathIntent(transcript, useHindiMode);
  if (isFastPath) {
    return { isQuery: false, confidence: 1.0, reason: 'greeting_or_control' };
  }
  
  // Contains question marks or question words?
  const hasQuestionMarks = /\?/.test(transcript);
  const questionWords = useHindiMode 
    ? ['kya', 'kaise', 'kaun', 'kahan', 'kab']
    : ['what', 'how', 'who', 'where', 'when', 'which', 'why'];
  
  const hasQuestionWord = questionWords.some(q => transcript.toLowerCase().includes(q));
  
  if (hasQuestionMarks || hasQuestionWord) {
    return { isQuery: true, confidence: 0.9, reason: 'has_question_marker' };
  }
  
  // Keywords suggesting it's a query
  const queryKeywords = useHindiMode
    ? ['seo', 'google', 'package', 'price', 'cost', 'help', 'chahiye', 'batao', 'service']
    : ['seo', 'google', 'package', 'price', 'cost', 'help', 'want', 'need', 'service'];
  
  const hasQueryKeyword = queryKeywords.some(k => transcript.toLowerCase().includes(k));
  
  if (hasQueryKeyword) {
    return { isQuery: true, confidence: 0.8, reason: 'has_query_keyword' };
  }
  
  // Default: assume it's a query if it's longer than 3 words
  const wordCount = transcript.split(/\s+/).length;
  if (wordCount > 3) {
    return { isQuery: true, confidence: 0.6, reason: 'medium_length' };
  }
  
  return { isQuery: false, confidence: 0.4, reason: 'unclear' };
}

module.exports = {
  checkFastPath,
  isFastPathIntent,
  getWaitingMessage,
  mergeFastPaths,
  assessIfRealQuery,
  FAST_PATHS_ENGLISH,
  FAST_PATHS_HINDI,
};
