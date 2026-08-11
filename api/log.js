// Vercel serverless function: forwards anonymous usage events to a Google Sheet.
// No dependencies. If SHEET_WEBHOOK_URL isn't set, it's a silent no-op so the app
// never breaks. Logs NO names or emails — only event type, division, and text.
const WEBHOOK = process.env.SHEET_WEBHOOK_URL;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!WEBHOOK) { res.status(200).json({ ok: false, skipped: "not_configured" }); return; }

  let p;
  try { p = await readJson(req); }
  catch { res.status(200).json({ ok: false }); return; }

  const type = String(p.type || "").slice(0, 40);
  if (!type) { res.status(200).json({ ok: false }); return; }
  const payload = {
    ts: new Date().toISOString(),
    type,
    division: String(p.division || "").slice(0, 80),
    detail: String(p.detail || "").slice(0, 1200),
    detail2: String(p.detail2 || "").slice(0, 4000),
  };

  try {
    // Fire the append at the Google Apps Script web app. Follow its redirect.
    await fetch(WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow",
    });
  } catch (e) {
    console.error("log forward failed", e);
    // Swallow — analytics must never surface as an error to the user.
  }
  res.status(200).json({ ok: true });
};
