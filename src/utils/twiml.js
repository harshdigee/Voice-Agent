// ==========================================================
// ✅ Twilio TwiML Utilities for Voice Assistant
// ==========================================================
import twilio from "twilio";
const { twiml: Twiml } = twilio;
import { CONFIG } from "../config.js";

/**
 * Creates a Twilio <Gather> that listens for speech and/or DTMF input.
 */
export function createGather({
  action = "/voice/collect",
  numDigits = 1,
  speechTimeout = "auto",
  enableSpeech = true,
  enableDtmf = true,
} = {}) {
  const vr = new Twiml.VoiceResponse();
  const input = [];
  if (enableSpeech) input.push("speech");
  if (enableDtmf) input.push("dtmf");

  const gather = vr.gather({
    input: input.join(" "),
    action,
    method: "POST",
    language: CONFIG.TWILIO.VOICE_LANGUAGE,
    hints: CONFIG.TWILIO.VOICE_HINTS,
    profanityFilter: false,
    speechTimeout,
  });

  return { vr, gather };
}

/**
 * Ends the call after speaking a final message.
 */
export function sayAndHangup(text, vr = new Twiml.VoiceResponse()) {
  vr.say({ language: CONFIG.TWILIO.VOICE_LANGUAGE }, text);
  vr.hangup();
  return vr;
}

/**
 * Speaks a message, then reopens a new <Gather> to keep the conversation going.
 */
export function sayAndContinue(text, action = "/voice/collect") {
  const vr = new Twiml.VoiceResponse();

  // Step 1: say the AI's message
  vr.say({ language: CONFIG.TWILIO.VOICE_LANGUAGE }, text);

  // Step 2: reopen a new gather so user can reply again
  const gather = vr.gather({
    input: "speech dtmf",
    action,
    method: "POST",
    language: CONFIG.TWILIO.VOICE_LANGUAGE,
    hints: CONFIG.TWILIO.VOICE_HINTS,
    speechTimeout: "auto",
    timeout: 10, // seconds of silence before re-prompt
  });

  // Optional prompt for clarity
  gather.say(
    { language: CONFIG.TWILIO.VOICE_LANGUAGE },
    "You can ask another question or press a key."
  );

  return vr;
}

/**
 * If user stays silent, gently re-prompt.
 */
export function noInputResponse() {
  const vr = new Twiml.VoiceResponse();
  vr.say(
    { language: CONFIG.TWILIO.VOICE_LANGUAGE },
    "Sorry, I didn't hear anything. You can ask me a question or press a key."
  );

  const gather = vr.gather({
    input: "speech dtmf",
    action: "/voice/collect",
    method: "POST",
    language: CONFIG.TWILIO.VOICE_LANGUAGE,
    speechTimeout: "auto",
  });

  gather.say(
    { language: CONFIG.TWILIO.VOICE_LANGUAGE },
    "Please tell me what you’d like to know."
  );

  return vr;
}
