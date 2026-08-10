// Vercel serverless function: emails a rule suggestion to the league via Web3Forms.
// No dependencies — calls the Web3Forms REST API with built-in fetch.
// The access key is kept server-side (env var); the destination inbox is whatever
// you configured on your Web3Forms account.
const RULES = require("../rules.js");
const WEB3FORMS_URL = "https://api.web3forms.com/submit";

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
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const ACCESS_KEY = process.env.WEB3FORMS_ACCESS_KEY;
  if (!ACCESS_KEY) {
    res.status(503).json({
      error: "not_configured",
      message: "Suggestions email isn't set up yet — a WEB3FORMS_ACCESS_KEY needs to be added to the app's environment variables.",
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

  // Web3Forms turns these fields into the email body. `subject`, `from_name`,
  // and `replyto` are recognized special fields; everything else is shown as-is.
  const payload = {
    access_key: ACCESS_KEY,
    subject: `SFL Rule Suggestion — ${divLabel}`,
    from_name: name || "SFL Rules App",
    "Submitted by": email ? `${name} <${email}>` : name,
    "Division": divLabel,
    "Suggested rule / change": suggestion,
    "Reasoning": rationale || "(none given)",
  };
  if (email) payload.replyto = email;

  try {
    const r = await fetch(WEB3FORMS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));

    if (r.ok && data.success) {
      res.status(200).json({ ok: true });
    } else {
      console.error("Web3Forms error", r.status, data);
      res.status(502).json({ error: "upstream", message: (data && data.message) || "Couldn't send the suggestion right now. Please try again." });
    }
  } catch (e) {
    console.error("suggest handler failed", e);
    res.status(500).json({ error: "server", message: "Something went wrong sending the suggestion." });
  }
};
