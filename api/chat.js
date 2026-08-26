// Vercel serverless function: grounded rules chat.
// Holds the Anthropic API key server-side and answers ONLY from the selected
// division's official rule text. No dependencies — uses built-in fetch (Node 18+).
const RULES = require("../rules.js");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({
      error: "not_configured",
      message: "The AI chat isn't set up yet — an ANTHROPIC_API_KEY needs to be added to the app's environment variables.",
    });
    return;
  }

  let payload;
  try { payload = await readJson(req); }
  catch { res.status(400).json({ error: "Invalid JSON" }); return; }

  const { division, messages } = payload || {};
  const div = RULES.divisions[division];
  if (!div) { res.status(400).json({ error: "Unknown division" }); return; }
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "No messages" }); return;
  }

  // Keep only role/content and cap history length to stay lean.
  const history = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content }));

  const system = [
    `You are the SFL Rules Assistant for the Southwest Football League (sfltx.org), a Houston youth football & cheer nonprofit.`,
    `You answer questions ONLY about the "${div.label}" rulebook, whose full official text is provided below.`,
    ``,
    `Rules:`,
    `- KEEP ANSWERS SHORT: 1-3 sentences, under ~60 words. Lead with the direct answer. Do not restate the question, add background, or walk through every interval/branch unless the person explicitly asks for more detail.`,
    `- Base every answer strictly on the rulebook text below. Do not invent, assume, or use outside football knowledge.`,
    `- When the rulebook does not cover something, say so plainly and suggest the coach contact the league — do not guess.`,
    `- The rulebook below may begin with DIVISION PROVISIONS (adjustments for this specific division). Those provisions OVERRIDE the general rules wherever they differ — always apply them first. (For ${div.label}, e.g., Freshman has no 4th down, no legal blitzing, no no-run zone, and a five-second pass clock.)`,
    `- Cite the rule you rely on by wrapping the EXACT section heading from the rulebook in double curly braces so the app can turn it into a link — e.g. {{BLITZER AND RUSHER}}, {{POSSESSION AND CHANGE OF POSSESSION}}, {{OFFENSIVE PENALTIES}}. Only brace headings that appear verbatim in the rulebook below, and put the citation next to the claim it supports.`,
    `- If the ruling depends on a detail the person hasn't given (where the ball is spotted / field position, the exact penalty, down & distance, run vs pass, who has possession, etc.), ask ONE short clarifying question and STOP. Do NOT answer the possible cases yourself in that message, and never ask a question and then answer it in the same breath — wait for their reply, then give the one tailored ruling.`,
    `- If the question is already specific enough to answer cleanly, answer it directly — no unnecessary questions.`,
    `- Think it through and get it right. Reason step by step about the specific situation; do not pattern-match to standard tackle/NFL football. Watch the down system in {{POSSESSION AND CHANGE OF POSSESSION}} (three downs to cross each interval; failing to cross can be a change of possession) and apply any division provisions over it.`,
    `- Tailor the answer to their situation. Lead with the direct answer, add the one key detail, keep it to a couple of sentences.`,
    `- Be conversational and practical, like a rules official helping a youth coach or parent. Quote exact rule wording when specifics matter.`,
    `- If asked about a different division/format, note that this assistant is scoped to ${div.label} and they can switch divisions in the app.`,
    ``,
    `===== OFFICIAL RULEBOOK: ${div.label} (${RULES.updated}) =====`,
    div.fullText,
    `===== END OF RULEBOOK =====`,
  ].join("\n");

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system,
        messages: history,
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error("Anthropic error", r.status, detail);
      res.status(502).json({
        error: "upstream",
        message: "The AI service returned an error. Please try again in a moment.",
      });
      return;
    }

    const data = await r.json();
    const reply = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    res.status(200).json({ reply: reply || "(no answer returned)" });
  } catch (e) {
    console.error("chat handler failed", e);
    res.status(500).json({ error: "server", message: "Something went wrong reaching the AI service." });
  }
};
