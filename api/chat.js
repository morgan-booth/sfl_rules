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
    `- Base every answer strictly on the rulebook text below. Do not invent, assume, or use outside football knowledge.`,
    `- When the rulebook does not cover something, say so plainly and suggest the coach contact the league — do not guess.`,
    `- Cite the section by name (e.g., "under BLITZER AND RUSHER") so coaches can verify.`,
    `- Ask before you answer when it matters. If the ruling depends on specifics the person hasn't given — the exact penalty, down & distance, field position, run vs pass, who has possession, etc. — ask ONE or TWO short clarifying questions first, instead of listing every possible case. Only give the ruling once you have what you need.`,
    `- Tailor the answer to their actual situation. Don't enumerate every branch unless it truly applies. Lead with the direct answer for their case, then the one key detail and the section name. Keep it short — a couple of sentences is ideal.`,
    `- If the question is already specific enough to answer cleanly, just answer it — don't ask unnecessary questions.`,
    `- Be conversational and practical, like a rules official helping a youth coach or parent. Quote exact rule wording when the specifics matter.`,
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
        max_tokens: 1024,
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
