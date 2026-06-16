// =============================================================
// Vobiz XML Builder — generates Vobiz-compatible Response XML.
// Vobiz uses <Speak> (not <Say>), <Gather inputType="...">, etc.
// Docs: https://docs.vobiz.ai/xml/overview
// =============================================================

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function speak(text, language = 'en-IN') {
  return `<Speak language="${language}">${escapeXml(text)}</Speak>`;
}

export function wait(length = 1) {
  return `<Wait length="${length}"/>`;
}

export function hangup() {
  return '<Hangup/>';
}

export function dial(number, callerId) {
  const attr = callerId ? ` callerId="${callerId}"` : '';
  return `<Dial${attr}>${number}</Dial>`;
}

/**
 * Build a <Gather> element.
 * @param {Object} opts
 * @param {string} opts.action         - Full URL for action callback (required)
 * @param {string} opts.inputType      - 'dtmf', 'speech', or 'dtmf speech' (default: 'dtmf speech')
 * @param {number} opts.executionTimeout - seconds to wait for input (default: 10)
 * @param {string} opts.language       - ASR language (default: 'en-IN')
 * @param {number} opts.numDigits      - max digits if dtmf (optional)
 * @param {string} opts.hints          - comma-separated speech hints (optional)
 * @param {...string} children         - nested <Speak>/<Wait> elements
 */
export function gather(opts = {}, ...children) {
  const {
    action,
    inputType = 'dtmf speech',
    executionTimeout = 10,
    language = 'en-IN',
    numDigits,
    hints,
    method = 'POST',
  } = opts;

  let attrs = `inputType="${inputType}" action="${action}" method="${method}" language="${language}" executionTimeout="${executionTimeout}"`;
  if (numDigits) attrs += ` numDigits="${numDigits}"`;
  if (hints) attrs += ` hints="${escapeXml(hints)}"`;

  return `<Gather ${attrs}>${children.join('')}</Gather>`;
}

/**
 * Wrap all elements in a <Response> root and prepend XML header.
 * Usage: response(speak(...), gather(...), hangup())
 */
export function response(...elements) {
  return `${XML_HEADER}<Response>${elements.join('')}</Response>`;
}

/**
 * Send Vobiz XML response with correct content-type.
 */
export function sendXml(res, xml) {
  res.type('application/xml').send(xml);
}
