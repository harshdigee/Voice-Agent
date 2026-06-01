import { createGather, sayAndHangup, sayAndContinue, noInputResponse } from '../utils/twiml.js';
import { classifyUtterance } from '../services/nlu.js';
import { fetchSalesReps, getCounts, listNames } from '../services/knowledge.js';
import { log } from '../utils/logger.js';

export async function inbound(req, res) {
  const { vr, gather } = createGather({ action: '/voice/collect', speechTimeout: 'auto' });

  gather.say('Hello! Thanks for calling Simply Synced AI Support.');
  gather.say('Please tell me the reason for your call. For example, "How many sales reps are present?"');
  gather.pause({ length: 1 });
  gather.say('You can also press 1 to hear the total count of sales reps, or press 2 to list the first five names.');

  res.type('text/xml').send(vr.toString());
}

export async function collect(req, res) {
  const speech = (req.body.SpeechResult || '').toLowerCase().trim();
  const digits = req.body.Digits || '';
  log.info('SpeechResult:', speech, 'Digits:', digits);

  // 🧩 Goodbye detection
  const goodbyes = ['bye', 'goodbye', 'exit', 'thank you', 'thanks', 'that\'s all'];
  if (goodbyes.some((kw) => speech.includes(kw))) {
    const vr = sayAndHangup('Thank you for calling Simply Synced AI Support. Have a great day!');
    return res.type('text/xml').send(vr.toString());
  }

  // 🧩 DTMF shortcuts
  if (digits === '1') {
    return respondSalesRepCount(req, res, { activeOnly: false });
  }
  if (digits === '2') {
    return respondListSalesReps(req, res);
  }

  // 🧩 If no speech or input
  if (!speech) {
    const vr = noInputResponse();
    return res.type('text/xml').send(vr.toString());
  }

  // 🧩 NLU classification
  const nlu = await classifyUtterance(speech);
  log.info('NLU:', nlu);

  switch (nlu.intent) {
    case 'GET_SALES_REP_COUNT':
      return respondSalesRepCount(req, res, nlu.params || {});
    case 'LIST_SALES_REPS':
      return respondListSalesReps(req, res);
    case 'HELP':
      return respondHelp(req, res);
    case 'REPEAT':
      return respondRepeat(req, res);
    default: {
      const vr = sayAndContinue(
        'Sorry, that request is beyond my current capabilities. But I have noted it for future improvements.'
      );
      return res.type('text/xml').send(vr.toString());
    }
  }
}

// ======================================================
// 🔹 HANDLERS
// ======================================================

async function respondSalesRepCount(req, res, { activeOnly = false } = {}) {
  const reps = await fetchSalesReps();
  if (!reps.ok) {
    const vr = sayAndContinue('Sorry, I could not fetch the sales representative data right now. Please try again later.');
    return res.type('text/xml').send(vr.toString());
  }

  const { total, active, result } = getCounts(reps.data, { activeOnly });
  const text = activeOnly
    ? `There are ${active} active sales representatives at the moment.`
    : `There are ${total} sales representatives in total.`;

  const vr = sayAndContinue(text);
  return res.type('text/xml').send(vr.toString());
}

async function respondListSalesReps(req, res) {
  const reps = await fetchSalesReps();
  if (!reps.ok) {
    const vr = sayAndContinue('Sorry, I could not fetch the sales representative names right now. Please try again later.');
    return res.type('text/xml').send(vr.toString());
  }

  const names = listNames(reps.data, 5);
  const text = names.length
    ? `Here are the first ${names.length} names: ${names.join(', ')}.`
    : 'I could not find any sales representatives.';

  const vr = sayAndContinue(text);
  return res.type('text/xml').send(vr.toString());
}

async function respondHelp(req, res) {
  const { vr, gather } = createGather({ action: '/voice/collect' });
  gather.say('You can ask, "How many sales reps are present?", or "List sales rep names".');
  gather.say('You can also press 1 for the total count, or press 2 for names.');
  return res.type('text/xml').send(vr.toString());
}

async function respondRepeat(req, res) {
  const { vr, gather } = createGather({ action: '/voice/collect' });
  gather.say('Repeating the options: Ask about sales rep counts or names. Press 1 for count, or press 2 for names.');
  return res.type('text/xml').send(vr.toString());
}
