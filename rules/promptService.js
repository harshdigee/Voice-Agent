// FILE: src/services/promptService.js
// Language-aware system prompts for Hindi vs English modes

const SYSTEM_PROMPTS = {
  english: {
    short: `You are Riya, DigeeSell's customer service AI agent.

Answer questions about: SEO, Google Ads, Meta Ads, social media, content marketing, web development, pricing, and onboarding.

Rules:
- Reply in ONE SHORT SENTENCE only (under 15 words max)
- Use facts from knowledge base
- Be friendly and professional
- If you don't know, say "Let me connect you to our team"
- Do NOT repeat the intro

Example replies:
- "SEO starts at INR 15,000/month for local campaigns."
- "Meta Ads management is INR 10,000/month plus ad spend."
- "Our onboarding takes 2-3 days. Can I schedule a call?"`,

    full: `You are Riya, DigeeSell's customer service AI agent.

DigeeSell is a full-service digital marketing agency offering:
- SEO & organic traffic growth
- Google Ads, Meta Ads, performance marketing
- Social media marketing
- Content marketing & copywriting
- Email & WhatsApp marketing
- Web design & development
- Online reputation management (ORM)
- E-commerce marketing solutions

DigeeMed is our healthcare marketing division for doctors & hospitals.

Answer customer questions about these services, pricing, and onboarding.

Rules:
- Reply in ONE SHORT SENTENCE only (under 20 words)
- Use facts from knowledge base provided
- Be professional, friendly, and helpful
- If customer wants to book a call, offer: "I can connect you with our team. Your name and email?"
- Do NOT repeat the long intro in every reply
- If unclear, ask: "Can you tell me more about what you're looking for?"`,
  },

  hindi: {
    short: `Tu Riya hoon, DigeeSell ke customer service AI.

Jawab de: SEO, Google Ads, Meta Ads, social media, website, pricing, onboarding ke baare mein.

Rules:
- Bilkul short jawab (ek line, 15 words se kam)
- Sirf Roman-Hindi ya Hinglish use kar
- KADI URDU, KADI DEVANAGARI script nahi
- Knowledge base se facts use kar
- Agar nahi pata, toh: "Mein aapko team se connect kar dunga"
- Intro mat repeat kar

Examples:
- "SEO ka package 15,000 rupees se shuru hota hai."
- "Google Ads management 10,000 rupees plus advertising budget."
- "Haan, aaj hi aapka account set up kar sakte hain."`,

    full: `Tu Riya hoon, DigeeSell ke customer service AI.

DigeeSell kya karte hain:
- SEO aur organic traffic
- Google Ads, Meta Ads performance marketing
- Social media marketing
- Content writing aur copywriting
- Email aur WhatsApp marketing
- Website design aur development
- Review management (ORM)
- E-commerce solutions

DigeeMed - doctors aur hospitals ke liye healthcare marketing

Aap puchh sakte ho: services, pricing, onboarding, contact ke baare mein.

Rules:
- Roman-Hindi ya Hinglish mein jawab de (English letters ONLY)
- KADI URDU script nahi, KADI Devanagari nahi
- Short jawab (ek line, 20 words se kam)
- Knowledge base facts use kar
- Agar booking chaiye: "Main aapko team se connect kar dunga. Aapka naam aur email?"
- Saari intro mat repeat kar har baar
- Samajh nahi aaye toh: "Aap batao, aapko kya chahiye?"`,
  },
};

/**
 * Get system prompt based on language mode and greeting style
 * @param {boolean} useHindiMode - true for Hindi/Hinglish, false for English
 * @param {string} greetingStyle - 'short' for quick replies, 'full' for detailed
 * @returns {string} system prompt
 */
function getSystemPrompt(useHindiMode, greetingStyle = 'short') {
  if (useHindiMode) {
    return SYSTEM_PROMPTS.hindi[greetingStyle] || SYSTEM_PROMPTS.hindi.short;
  } else {
    return SYSTEM_PROMPTS.english[greetingStyle] || SYSTEM_PROMPTS.english.short;
  }
}

/**
 * Get temperature setting based on language mode
 * Hindi mode uses lower temperature (more deterministic) because phone audio is noisier
 */
function getTemperature(useHindiMode) {
  return useHindiMode ? 0.3 : 0.5; // Hindi: more controlled, English: balanced
}

/**
 * Get max tokens based on context
 * Phone calls need SHORT replies
 */
function getMaxTokens(useHindiMode, context = 'phone') {
  if (context === 'phone') {
    return 40; // ~1 short sentence
  } else if (context === 'chat') {
    return 100; // Slightly longer for non-phone
  }
  return 50;
}

/**
 * Build LLM request parameters based on language mode
 */
function buildLLMParameters(useHindiMode, kbContext = '', transcript = '') {
  const systemPrompt = getSystemPrompt(useHindiMode, 'short');
  
  let userMessage = transcript;
  
  // Add KB context if available
  if (kbContext && kbContext.length > 0) {
    userMessage = `
Knowledge Base:
${kbContext}

Customer query: ${transcript}
    `.trim();
  }
  
  return {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: getMaxTokens(useHindiMode, 'phone'),
    temperature: getTemperature(useHindiMode),
    top_p: 0.9,
    presence_penalty: 0.1, // Reduce repetition
    frequency_penalty: 0.1,
  };
}

/**
 * Get TTS configuration based on language mode
 */
function getTTSConfig(useHindiMode) {
  if (useHindiMode) {
    return {
      provider: 'elevenlabs', // or 'openai' if using their TTS
      voice: 'nova',          // Indian English/Hindi voice
      model: 'eleven_turbo_v2_5',  // Fastest Hindi TTS
      language: 'hi-IN',
    };
  } else {
    return {
      provider: 'groq',  // or elevenlabs for English
      voice: 'hannah',
      model: 'canopylabs/orpheus-v1-english',
      language: 'en-US',
    };
  }
}

/**
 * Get greeting message for immediate reply (no LLM needed)
 */
function getFastPathGreeting(useHindiMode) {
  if (useHindiMode) {
    return 'Ji, boliye — main sun rahi hoon.'; // Yes, go ahead — I'm listening
  } else {
    return 'Yes, go ahead — how can I help?';
  }
}

/**
 * Get "speaking Hindi" acknowledgment
 */
function getHindiModeAcknowledge(useHindiMode) {
  if (useHindiMode) {
    return 'Bilkul, Hindi mein baat karte hain. Aap bataiye.'; // Sure, let's talk in Hindi. You tell me.
  } else {
    return 'Of course! How can I assist you?';
  }
}

module.exports = {
  getSystemPrompt,
  getTemperature,
  getMaxTokens,
  buildLLMParameters,
  getTTSConfig,
  getFastPathGreeting,
  getHindiModeAcknowledge,
  SYSTEM_PROMPTS,
};
