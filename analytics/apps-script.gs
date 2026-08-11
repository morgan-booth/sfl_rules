/**
 * SFL Rules — usage log receiver (Google Apps Script).
 *
 * SETUP (one time, ~5 minutes):
 *  1. Create a new Google Sheet (this is where the log lands). Name it e.g. "SFL Rules Log".
 *  2. In that sheet: Extensions → Apps Script. Delete any sample code and paste THIS file.
 *  3. Click Deploy → New deployment → (gear) Web app.
 *       - Description:      SFL Rules log
 *       - Execute as:       Me
 *       - Who has access:   Anyone
 *     Click Deploy, authorize when prompted, and COPY the Web app URL (ends in /exec).
 *  4. In Vercel → your project → Settings → Environment Variables, add:
 *       SHEET_WEBHOOK_URL = <the /exec URL you copied>
 *     Then redeploy the app.
 *
 * Every event becomes one row: Timestamp | Type | Division | Text | AI response
 *  - type "chat":       Text = the question,  AI response = the AI's answer
 *  - type "search":     Text = the search query
 *  - type "rule_open":  Text = the rule section opened
 *  - type "division":   Text = "entered"      (Division column shows which one)
 *  - type "tab":        Text = ask | rules | suggest
 *  - type "suggestion": Text = which division(s) the suggestion applies to
 *
 * No names or emails are ever sent here.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Log") || ss.insertSheet("Log");
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Timestamp", "Type", "Division", "Text", "AI response"]);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([
      data.ts || new Date().toISOString(),
      data.type || "",
      data.division || "",
      data.detail || "",
      data.detail2 || ""
    ]);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}
