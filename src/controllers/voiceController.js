import { createGather, sayAndHangup, sayAndContinue, noInputResponse } from "../utils/twiml.js";
import { classifyUtterance } from "../services/nlu.js";
import { fetchSalesReps, getCounts, listNames, answerFromKnowledge } from "../services/knowledge.js";
import { CONFIG } from "../config.js";
import { log } from "../utils/logger.js";
import twilio from "twilio";

const { twiml: Twiml } = twilio;

// ─────────────────────────────────────────────────────────────
// INBOUND / OUTBOUND entry point
// Both inbound calls and outbound calls hit this handler.
// ─────────────────────────────────────────────────────────────
export async function inbound(req, res) {
  const { vr, gather } = createGather({ action: "/voice/collect", speechTimeout: "auto" });

  gather.say("Hello! Thanks for calling DigeeSell. I am your AI assistant.");
  gather.say("You can ask me about our services, pricing, or team.");
  gather.pause({ length: 1 });
  gather.say("Or press 9 at any time to speak with a team member.");

  res.type("text/xml").send(vr.toString());
}

// ─────────────────────────────────────────────────────────────
// COLLECT — handles speech + DTMF after gather
// ─────────────────────────────────────────────────────────────
export async function collect(req, res) {
  const speech = (req.body.SpeechResult || "").trim();
  const digits = (req.body.Digits || "").trim();
  log.info("collect → speech:", speech, "| digits:", digits);

  // ── Press 9 → forward to human ──────────────────────────────
  if (digits === "9") {
    return forwardToHuman(res);
  }

  // ── No input ────────────────────────────────────────────────
  if (!speech && !digits) {
    return res.type("text/xml").send(noInputResponse().toString());
  }

  // ── NLU classify ────────────────────────────────────────────
  const nlu = await classifyUtterance(speech || digits);
  log.info("NLU result:", nlu);

  switch (nlu.intent) {
    case "GOODBYE":
      return res.type("text/xml").send(
        sayAndHangup("Thank you for calling DigeeSell. Have a great day! Goodbye!").toString()
      );

    case "FORWARD_TO_HUMAN":
      return forwardToHuman(res);

    case "GET_SALES_REP_COUNT":
      return respondSalesRepCount(res, nlu.params || {});

    case "LIST_SALES_REPS":
      return respondListSalesReps(res);

    case "KNOWLEDGE_QUERY":
      return respondKnowledge(res, speech);

    case "HELP":
      return respondHelp(res);

    case "REPEAT":
      return respondRepeat(res);

    default: {
      // Still try KB for unknown questions before giving up
      if (speech.length > 3) {
        return respondKnowledge(res, speech);
      }
      const vr = sayAndContinue(
        "I'm not sure about that. You can ask about our services, pricing, or press 9 to speak with our team."
      );
      return res.type("text/xml").send(vr.toString());
    }
  }
}

// ─────────────────────────────────────────────────────────────
// FORWARD TO HUMAN — dials FORWARD_TO_NUMBER
// ─────────────────────────────────────────────────────────────
function forwardToHuman(res) {
  const forwardTo = CONFIG.FORWARD_TO_NUMBER;
  const from = CONFIG.TWILIO.FROM_NUMBER || process.env.TWILIO_FROM_NUMBER;

  if (!forwardTo) {
    const vr = sayAndContinue(
      "I'm sorry, I'm unable to connect you to a team member right now. Please call back during business hours."
    );
    return res.type("text/xml").send(vr.toString());
  }

  const vr = new Twiml.VoiceResponse();
  vr.say({ language: CONFIG.TWILIO.VOICE_LANGUAGE }, "Please hold, I am connecting you to a DigeeSell team member now.");
  vr.dial({ callerId: from || undefined }, forwardTo);
  return res.type("text/xml").send(vr.toString());
}

// ─────────────────────────────────────────────────────────────
// KNOWLEDGE BASE ANSWER
// ─────────────────────────────────────────────────────────────
async function respondKnowledge(res, question) {
  try {
    const answer = await answerFromKnowledge(question);
    const vr = sayAndContinue(answer);
    return res.type("text/xml").send(vr.toString());
  } catch (err) {
    log.error("respondKnowledge error:", err.message);
    const vr = sayAndContinue("I had trouble finding that answer. Press 9 to speak with our team.");
    return res.type("text/xml").send(vr.toString());
  }
}

// ─────────────────────────────────────────────────────────────
// SALES REP HELPERS
// ─────────────────────────────────────────────────────────────
async function respondSalesRepCount(res, { activeOnly = false } = {}) {
  const reps = await fetchSalesReps();
  if (!reps.ok) {
    const vr = sayAndContinue("Sorry, I could not fetch the team data right now. Please try again later.");
    return res.type("text/xml").send(vr.toString());
  }
  const { total, active } = getCounts(reps.data, { activeOnly });
  const text = activeOnly
    ? `There are ${active} active team members right now.`
    : `There are ${total} team members in total.`;
  return res.type("text/xml").send(sayAndContinue(text).toString());
}

async function respondListSalesReps(res) {
  const reps = await fetchSalesReps();
  if (!reps.ok) {
    const vr = sayAndContinue("Sorry, I could not fetch team names right now.");
    return res.type("text/xml").send(vr.toString());
  }
  const names = listNames(reps.data, 5);
  const text = names.length
    ? `Here are the first ${names.length} team members: ${names.join(", ")}.`
    : "I could not find any team members.";
  return res.type("text/xml").send(sayAndContinue(text).toString());
}

// ─────────────────────────────────────────────────────────────
// HELP / REPEAT
// ─────────────────────────────────────────────────────────────
function respondHelp(res) {
  const { vr, gather } = createGather({ action: "/voice/collect" });
  gather.say("You can ask me about DigeeSell services, pricing, social media marketing, SEO, and more.");
  gather.say("Say the name of a service, or ask any question. Press 9 to speak with our team.");
  return res.type("text/xml").send(vr.toString());
}

function respondRepeat(res) {
  const { vr, gather } = createGather({ action: "/voice/collect" });
  gather.say("I am your DigeeSell AI assistant. Ask me about our services, pricing, or team. Press 9 for a human agent.");
  return res.type("text/xml").send(vr.toString());
}
