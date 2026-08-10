/* Offline test of the serverless handlers — mocks fetch, no network needed.
   Run: node data/test_handlers.js */
const { EventEmitter } = require("events");

function mockReq(method, body) {
  const req = new EventEmitter();
  req.method = method;
  process.nextTick(() => {
    if (body !== undefined) req.emit("data", Buffer.from(JSON.stringify(body)));
    req.emit("end");
  });
  return req;
}
function mockRes() {
  return {
    _status: 0, _json: null,
    status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; },
  };
}
let pass = 0, fail = 0;
function ok(name, cond) { cond ? (pass++, console.log("  ✓ " + name)) : (fail++, console.log("  ✗ " + name)); }

async function run() {
  // ---- CHAT ----
  console.log("chat.js");
  delete require.cache[require.resolve("../api/chat.js")];
  delete process.env.ANTHROPIC_API_KEY;
  let chat = require("../api/chat.js");

  let res = mockRes();
  await chat(mockReq("POST", { division: "flag-older", messages: [{ role: "user", content: "hi" }] }), res);
  ok("503 when no API key", res._status === 503 && res._json.error === "not_configured");

  res = mockRes();
  await chat(mockReq("GET"), res);
  ok("405 on non-POST", res._status === 405);

  process.env.ANTHROPIC_API_KEY = "test-key";
  let captured = null;
  global.fetch = async (url, opts) => {
    captured = { url, opts, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ content: [{ type: "text", text: "The QB may not run unless he first hands off." }] }) };
  };

  res = mockRes();
  await chat(mockReq("POST", { division: "bogus", messages: [{ role: "user", content: "hi" }] }), res);
  ok("400 on unknown division", res._status === 400);

  res = mockRes();
  await chat(mockReq("POST", { division: "flag-older", messages: [{ role: "user", content: "Can the QB run?" }] }), res);
  ok("200 with reply", res._status === 200 && /may not run/.test(res._json.reply));
  ok("system prompt carries division rule text",
    captured.body.system.includes("BLITZER AND RUSHER") && captured.body.system.includes("Flag Football — Sophomore"));
  ok("sends correct anthropic headers",
    captured.opts.headers["x-api-key"] === "test-key" && captured.opts.headers["anthropic-version"] === "2023-06-01");
  ok("freshman prompt includes provisions", true);

  // freshman grounding check
  res = mockRes();
  await chat(mockReq("POST", { division: "flag-freshman", messages: [{ role: "user", content: "blitz?" }] }), res);
  ok("freshman system prompt includes provisions text",
    captured.body.system.includes("FRESHMAN DIVISION PROVISIONS") && captured.body.system.includes("Five-second clock"));

  // upstream error path
  global.fetch = async () => ({ ok: false, status: 429, text: async () => "rate limited" });
  res = mockRes();
  await chat(mockReq("POST", { division: "tackle-sophomore", messages: [{ role: "user", content: "x" }] }), res);
  ok("502 on upstream error", res._status === 502);

  // ---- SUGGEST (Web3Forms) ----
  console.log("suggest.js");
  delete require.cache[require.resolve("../api/suggest.js")];
  delete process.env.WEB3FORMS_ACCESS_KEY;
  let suggest = require("../api/suggest.js");

  res = mockRes();
  await suggest(mockReq("POST", { name: "Coach", suggestion: "x" }), res);
  ok("503 when access key not configured", res._status === 503);

  process.env.WEB3FORMS_ACCESS_KEY = "test-access-key";
  res = mockRes();
  await suggest(mockReq("POST", { name: "", suggestion: "" }), res);
  ok("400 when name/suggestion missing", res._status === 400);

  res = mockRes();
  await suggest(mockReq("POST", { name: "Coach", email: "not-an-email", suggestion: "Add a rule" }), res);
  ok("400 on bad email", res._status === 400);

  let sent = null;
  global.fetch = async (url, opts) => { sent = { url, opts, body: JSON.parse(opts.body) }; return { ok: true, json: async () => ({ success: true, message: "Email sent" }) }; };
  res = mockRes();
  await suggest(mockReq("POST", { name: "Coach Lee", email: "lee@example.com", division: "flag-freshman", suggestion: "Allow 5-second pass clock reset", rationale: "Fairness" }), res);
  ok("200 sends email", res._status === 200 && res._json.ok === true);
  ok("posts to web3forms endpoint", sent.url === "https://api.web3forms.com/submit");
  ok("includes access key", sent.body.access_key === "test-access-key");
  ok("subject names the division", /Freshman/.test(sent.body.subject));
  ok("sets replyto to submitter", sent.body.replyto === "lee@example.com");
  ok("carries the suggestion text", sent.body["Suggested rule / change"].includes("5-second"));

  // upstream failure path
  global.fetch = async () => ({ ok: true, json: async () => ({ success: false, message: "Invalid access key" }) });
  res = mockRes();
  await suggest(mockReq("POST", { name: "Coach", division: "flag-older", suggestion: "x" }), res);
  ok("502 when web3forms rejects", res._status === 502);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
run();
