/**
 * vobizXml.js — Vobiz XML response builder
 * Docs: https://docs.vobiz.ai/xml/overview
 *
 * Supported verbs: Speak, Play, Gather, Stream, Dial, Wait, Hangup, Redirect
 */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** <Speak> — Vobiz TTS */
export function speak(text, language = "en-IN") {
  return `<Speak language="${language}">${escapeXml(text)}</Speak>`;
}

/** <Play> — Play audio from a URL (MP3 / WAV) */
export function play(url) {
  return `<Play>${escapeXml(url)}</Play>`;
}

/** <Wait> — Silence pause */
export function wait(length = 1) {
  return `<Wait length="${length}"/>`;
}

/** <Hangup> */
export function hangup() {
  return "<Hangup/>";
}

/** <Redirect> — Redirect call flow to another URL */
export function redirect(url, method = "POST") {
  return `<Redirect method="${method}">${escapeXml(url)}</Redirect>`;
}

/** <Dial> — Connect to another number */
export function dial(number, callerId) {
  const attr = callerId ? ` callerId="${callerId}"` : "";
  return `<Dial${attr}>${escapeXml(number)}</Dial>`;
}

/**
 * <Stream> — Open a bidirectional WebSocket Media Stream.
 *
 * IMPORTANT: Per Vobiz docs, the WS URL is TEXT CONTENT of the element,
 * NOT a "url" attribute. Wrong format = Vobiz can't connect = duration=0s.
 *
 * contentType="audio/x-mulaw;rate=8000" → Vobiz sends us mulaw 8 kHz,
 * and expects mulaw 8 kHz back (matches our audio pipeline).
 *
 * keepCallAlive="true" → call stays up while stream is active.
 */
export function stream(url) {
  // audioTrack="inbound" is required with bidirectional="true" — Vobiz rejects
  // audioTrack="both" in bidirectional mode, which silently drops the stream.
  return `<Stream bidirectional="true" audioTrack="inbound" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">${escapeXml(url)}</Stream>`;
}

/**
 * <Gather> — Collect speech / DTMF (for fallback IVR flows)
 */
export function gather(opts = {}, ...children) {
  const {
    action,
    inputType = "dtmf speech",
    executionTimeout = 12,
    language = "en-IN",
    numDigits,
    hints,
    method = "POST",
    bargeIn = "true",
  } = opts;

  let attrs = [
    `inputType="${inputType}"`,
    `action="${escapeXml(action)}"`,
    `method="${method}"`,
    `language="${language}"`,
    `executionTimeout="${executionTimeout}"`,
    `bargeIn="${bargeIn}"`,
  ];
  if (numDigits) attrs.push(`numDigits="${numDigits}"`);
  if (hints)     attrs.push(`hints="${escapeXml(hints)}"`);

  return `<Gather ${attrs.join(" ")}>${children.join("")}</Gather>`;
}

/**
 * Wrap everything in <Response> with XML header.
 */
export function response(...elements) {
  return `${XML_HEADER}<Response>${elements.join("")}</Response>`;
}

/**
 * Send Vobiz XML with correct Content-Type.
 */
export function sendXml(res, xml) {
  res.type("application/xml").send(xml);
}
