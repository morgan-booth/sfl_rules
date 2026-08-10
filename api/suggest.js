// Vercel serverless function: emails a rule suggestion to the league via Resend.
// No dependencies — calls the Resend REST API with built-in fetch.
const RULES = require("../rules.js");
const RESEND_URL = "https://api.resend.com/emails";

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

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const TO = process.env.SUGGEST_TO;
  const FROM = process.env.SUGGEST_FROM || "SFL Rules App <onboarding@resend.dev>";
  if (!process.env.RESEND_API_KEY || !TO) {
    res.status(503).json({
      error: "not_configured",
      message: "Suggestions email isn't set up yet — a RESEND_API_KEY and SUGGEST_TO address need to be added to the app's environment variables.",
    });
    return;
  }

  let p;
  try { p = await readJson(req); }
  catch { res.status(400).json({ error: "Invalid JSON" }); return; }

  const name = (p.name || "").trim();
  const email = (p.email || "").trim();
  const suggestion = (p.suggestion || "").trim();
  const rationale = (p.rationale || "").trim();
  const div = RULES.divisions[p.division];
  const divLabel = div ? div.label : (p.division || "Not specified");

  if (!name || !suggestion) {
    res.status(400).json({ error: "missing", message: "Please include your name and a suggestion." });
    return;
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: "bad_email", message: "That email address doesn't look right." });
    return;
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
      <h2 style="color:#0B2A4A;border-bottom:3px solid #C8102E;padding-bottom:8px">New SFL Rule Suggestion</h2>
      <p><strong>From:</strong> ${esc(name)}${email ? ` &lt;${esc(email)}&gt;` : ""}</p>
      <p><strong>Division:</strong> ${esc(divLabel)}</p>
      <p><strong>Suggested rule / change:</strong></p>
      <p style="white-space:pre-wrap;background:#f4f6f9;padding:12px;border-radius:8px">${esc(suggestion)}</p>
      ${rationale ? `<p><strong>Reasoning:</strong></p>
      <p style="white-space:pre-wrap;background:#f4f6f9;padding:12px;border-radius:8px">${esc(rationale)}</p>` : ""}
      <p style="color:#888;font-size:12px;margin-top:24px">Submitted via the SFL Rules app.</p>
    </div>`;

  const text = `New SFL Rule Suggestion\n\nFrom: ${name}${email ? ` <${email}>` : ""}\nDivision: ${divLabel}\n\nSuggested rule / change:\n${suggestion}\n${rationale ? `\nReasoning:\n${rationale}\n` : ""}\n— Submitted via the SFL Rules app.`;

  try {
    const r = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: TO.split(",").map((s) => s.trim()).filter(Boolean),
        subject: `SFL Rule Suggestion — ${divLabel}`,
        html,
        text,
        ...(email ? { reply_to: email } : {}),
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error("Resend error", r.status, detail);
      res.status(502).json({ error: "upstream", message: "Couldn't send the suggestion right now. Please try again." });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("suggest handler failed", e);
    res.status(500).json({ error: "server", message: "Something went wrong sending the suggestion." });
  }
};
