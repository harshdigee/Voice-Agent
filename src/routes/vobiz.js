// =============================================================
// Vobiz Voice Routes — Inbound & Collect using Vobiz XML format
// Vobiz docs: https://docs.vobiz.ai/xml/overview
// Gather fields received: Speech, Digits, InputType
// =============================================================
import { Router } from "express";
import { classifyUtterance } from "../services/nlu.js";
import { fetchSalesReps, getCounts, listNames, answerFromKnowledge } from "../services/knowledge.js";
import { CONFIG } from "../config.js";
import { log } from "../utils/logger.js";
import { speak, gather, hangup, dial, wait, response, sendXml } from "../services/vobizXml.js";

const router = Router();
const LANG = 'en-IN';

function collectUrl() {
  return `${CONFIG.PUBLIC_BASE_URL}/vobiz/collect`;
}

function collectGather(...children) {
  return gather(
    {
      action: collectUrl(),
      inputType: 'dtmf speech',
      executionTimeout: 10,
      language: LANG,
      numDigits: 1,
      hints: 'sales,pricing,services,team,help,goodbye',
    },
    ...children
  );
}

// ─────────────────────────────────────────────────────────────
// POST /vobiz/inbound — Vobiz calls this when a call is received
// Vobiz sends: From, To, CallUUID, Direction, CallStatus
// ─────────────────────────────────────────────────────────────
router.post("/inbound", (req, res) => {
  log.info("Vobiz inbound →", { from: req.body.From, to: req.body.To, uuid: req.body.CallUUID });

  const xml = response(
    collectGather(
      speak("Hello! Thanks for calling DigeeSell. I am your AI assistant.", LANG),
      wait(1),
      speak("You can ask me about our services, pricing, or team. Or press 9 to speak with a team member.", LANG)
    ),
    speak("We didn't receive any input. Please call back. Goodbye!", LANG),
    hangup()
  );

  sendXml(res, xml);
});

// ─────────────────────────────────────────────────────────────
// POST /vobiz/collect — handles speech/DTMF input from <Gather>
// Vobiz sends: Speech, Digits, InputType, SpeechConfidenceScore
// ─────────────────────────────────────────────────────────────
router.post("/collect", async (req, res) => {
  const speech = (req.body.Speech || "").trim();
  const digits = (req.body.Digits || "").trim();
  const inputType = (req.body.InputType || "").toLowerCase();

  log.info("vobiz/collect →", { speech, digits, inputType, score: req.body.SpeechConfidenceScore });

  // ── Press 9 → forward to human ──────────────────────────────
  if (digits === "9") {
    const xml = response(
      speak("Please hold. I am connecting you to a DigeeSell team member now.", LANG),
      dial(CONFIG.FORWARD_TO_NUMBER, CONFIG.VOBIZ.NUMBER)
    );
    return sendXml(res, xml);
  }

  // ── No input at all ─────────────────────────────────────────
  if (!speech && !digits) {
    const xml = response(
      collectGather(
        speak("Sorry, I didn't hear anything. Please ask me a question or press 9 for a team member.", LANG)
      ),
      hangup()
    );
    return sendXml(res, xml);
  }

  // ── NLU classify ────────────────────────────────────────────
  let nlu;
  try {
    nlu = await classifyUtterance(speech || digits);
    log.info("NLU:", nlu);
  } catch (err) {
    log.error("NLU error:", err.message);
    nlu = { intent: "KNOWLEDGE_QUERY" };
  }

  switch (nlu.intent) {

    case "GOODBYE":
      return sendXml(res, response(
        speak("Thank you for calling DigeeSell. Have a great day! Goodbye!", LANG),
        hangup()
      ));

    case "FORWARD_TO_HUMAN":
      return sendXml(res, response(
        speak("Connecting you to our team now. Please hold.", LANG),
        dial(CONFIG.FORWARD_TO_NUMBER, CONFIG.VOBIZ.NUMBER)
      ));

    case "GET_SALES_REP_COUNT": {
      const reps = await fetchSalesReps();
      const { total, active } = getCounts(reps.data || []);
      const text = nlu.params?.activeOnly
        ? `There are ${active} active team members right now.`
        : `There are ${total} team members in total.`;
      return sendXml(res, response(
        collectGather(speak(text + " Is there anything else I can help you with?", LANG))
      ));
    }

    case "LIST_SALES_REPS": {
      const reps = await fetchSalesReps();
      const names = listNames(reps.data || [], 5);
      const text = names.length
        ? `Here are the first ${names.length} team members: ${names.join(", ")}.`
        : "I could not find any team members.";
      return sendXml(res, response(
        collectGather(speak(text + " Is there anything else?", LANG))
      ));
    }

    case "HELP":
      return sendXml(res, response(
        collectGather(
          speak("You can ask me about DigeeSell services, pricing, social media marketing, SEO, and more. Or press 9 to speak with our team.", LANG)
        )
      ));

    case "REPEAT":
      return sendXml(res, response(
        collectGather(
          speak("I am your DigeeSell AI assistant. Ask me about our services, pricing, or team. Press 9 for a human agent.", LANG)
        )
      ));

    case "KNOWLEDGE_QUERY":
    default: {
      let text;
      if (speech.length > 3) {
        try {
          text = await answerFromKnowledge(speech);
        } catch (err) {
          log.error("Knowledge error:", err.message);
          text = "I had trouble finding that answer. Press 9 to speak with our team.";
        }
      } else {
        text = "I'm not sure about that. Press 9 to speak with our team, or ask another question.";
      }
      return sendXml(res, response(
        collectGather(speak(text, LANG))
      ));
    }
  }
});

// ─────────────────────────────────────────────────────────────
// POST /vobiz/webhook — real-time call event notifications
// Events: Ring, StartApp, Hangup — Vobiz sends these async
// ─────────────────────────────────────────────────────────────
router.post("/webhook", (req, res) => {
  log.info("Vobiz webhook event →", {
    event: req.body.Event,
    status: req.body.CallStatus,
    from: req.body.From,
    to: req.body.To,
    uuid: req.body.CallUUID,
  });
  res.status(200).json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// POST /vobiz/status — hangup/completion callback for outbound
// ─────────────────────────────────────────────────────────────
router.post("/status", (req, res) => {
  log.info("Vobiz call completed →", {
    status: req.body.CallStatus,
    from: req.body.From,
    to: req.body.To,
    duration: req.body.Duration,
    start: req.body.StartTime,
    end: req.body.EndTime,
  });
  res.status(200).json({ ok: true });
});

export default router;
