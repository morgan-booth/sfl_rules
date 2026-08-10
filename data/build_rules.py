#!/usr/bin/env python3
"""Parse the SFL rulebook plain-text extracts into structured JSON for the app.
Source of truth: data/raw/*.txt (from pdftotext -layout). Output: public/rules.js
Both the lookup (browsable sections) and the chat grounding (fullText) derive from
the same parsed content so nothing drifts from the official PDFs."""
import re, json, os

RAW = os.path.join(os.path.dirname(__file__), "raw")
OUT = os.path.join(os.path.dirname(__file__), "..", "rules.js")

def norm(s):
    return re.sub(r"\s+", " ", s.strip()).upper()

def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

# ---------- FLAG ----------
FLAG_HEADERS = [
    (1, "GENERAL PROVISIONS"),
    (2, "ROSTERS AND ELIGIBILITY"), (2, "COACHES"),
    (2, "FIELD DIMENSIONS AND EQUIPMENT"), (2, "TEAM FORMATION"),
    (2, "NO COMMUNICATION DEVICES"), (2, "DRONE USE PROHIBITED"),
    (1, "SPORTSMANSHIP AND CONDUCT"),
    (2, "PLAYER CONDUCT"), (2, "OFFENSIVE LANGUAGE"),
    (2, "COACH AND SPECTATOR CONDUCT"), (2, "FIELD SAFETY"),
    (2, "PARTICIPATION RULE"), (2, "COACH AND PARENT PARTICIPATION"),
    (2, "SIDELINE ASSIGNMENTS"), (2, "PLAYOFF SEEDINGS"),
    (1, "GENERAL GAME PROVISIONS"),
    (2, "START OF GAME"), (2, "POSSESSION AND CHANGE OF POSSESSION"),
    (2, "NO-RUN ZONE"), (2, "GAME CLOCK"), (2, "DELAY OF GAME"),
    (2, "TIMEOUTS"), (2, "INJURY STOPPAGE"), (2, "OVERTIME"),
    (1, "GAME PLAY"),
    (2, "BALL SPOT"), (2, "LIVE AND DEAD BALL"), (2, "INADVERTENT WHISTLE"),
    (2, "PRE-SNAP DEFENSE"), (2, "OFFENSIVE PLAYS"), (2, "SCORING"),
    (2, "SAFETY"), (2, "MERCY RULE"),
    (1, "OFFENSE"),
    (2, "OFFENSIVE FORMATION"), (2, "MOTION"), (2, "RUNNING"), (2, "PASSING"),
    (1, "DEFENSE"),
    (2, "BLITZER AND RUSHER"), (2, "FLAG PULLING"),
    (1, "OFFICIALS AND PENALTIES"),
    (2, "OFFICIALS"), (2, "GENERAL PENALTY PROVISIONS"),
    (2, "DEFENSIVE SPOT PENALTIES"), (2, "DEFENSIVE LINE OF SCRIMMAGE PENALTIES"),
    (2, "OFFENSIVE SPOT PENALTIES"), (2, "OFFENSIVE LINE OF SCRIMMAGE PENALTIES"),
    (1, "SUMMARY FRESHMAN DIVISION PROVISIONS"),
]

DROP_TITLES = {"FLAG FOOTBALL", "OFFICIAL RULEBOOK", "2026",
               "AS OF AUGUST 1, 2026", "TABLE OF CONTENTS", "CONTENTS"}

def clean_lines(text):
    out = []
    for ln in text.split("\n"):
        ln = ln.replace("\f", "")
        s = ln.strip()
        if not s:
            out.append("")
            continue
        if re.fullmatch(r"\d{1,3}", s):        # bare page-number footer
            continue
        if re.search(r"\.{2,}", s):            # TOC dotted leaders
            continue
        if norm(s) in DROP_TITLES:
            continue
        out.append(ln.rstrip())
    return out

def collapse_blanks(txt):
    txt = re.sub(r"\n{3,}", "\n\n", txt).strip()
    return txt

def parse_penalty_rows(text):
    """Turn a space-aligned two-column penalty table into {label,value} rows."""
    rows = []
    for ln in text.split("\n"):
        if not ln.strip():
            continue
        parts = re.split(r"\s{2,}", ln.strip())
        leading_ws = len(ln) - len(ln.lstrip())
        if len(parts) >= 2 and leading_ws < 20 and parts[0] and not parts[0].startswith("*"):
            rows.append({"label": parts[0].strip(),
                         "value": " ".join(p.strip() for p in parts[1:]).strip()})
        elif rows:  # continuation / wrapped line
            rows[-1]["value"] = (rows[-1]["value"] + " " + ln.strip()).strip()
    return rows

def parse_flag():
    text = open(os.path.join(RAW, "flag.txt")).read()
    lines = clean_lines(text)
    hdr_norm = [norm(h) for _, h in FLAG_HEADERS]
    ptr = 0
    groups, cur_group, cur_sec = [], None, None
    buf = []
    def flush():
        nonlocal buf, cur_sec
        if cur_sec is not None:
            cur_sec["text"] = collapse_blanks("\n".join(buf))
        buf = []
    for ln in lines:
        s = norm(ln)
        if ptr < len(FLAG_HEADERS) and s == hdr_norm[ptr]:
            flush()
            lvl, title = FLAG_HEADERS[ptr]
            ptr += 1
            if lvl == 1:
                cur_group = {"title": title, "id": slug(title), "sections": []}
                groups.append(cur_group)
                cur_sec = None
            else:
                cur_sec = {"title": title, "id": slug(title), "text": ""}
                cur_group["sections"].append(cur_sec)
            continue
        if cur_sec is not None:
            buf.append(ln)
    flush()
    # drop empty group (the freshman-summary divider carries no sub-sections)
    groups = [g for g in groups if g["sections"]]
    # structure the penalty tables into rows for clean rendering
    for g in groups:
        for sec in g["sections"]:
            if sec["id"].endswith("penalties"):
                sec["rows"] = parse_penalty_rows(sec["text"])
    # full text for chat grounding
    full = []
    for g in groups:
        full.append(g["title"])
        for sec in g["sections"]:
            full.append(sec["title"])
            if sec["text"]:
                full.append(sec["text"])
    return groups, collapse_blanks("\n\n".join(full))

# ---------- TACKLE ----------
TACKLE_HEADERS = [
    "GAME PLAY:",
    "The Clock will be stopped for the following reasons:",
    "SPECIAL TEAMS:",
    "POINT SYSTEM:",
    "SUBSTITUTION / PLAY RULE:",
    "REQUIRED and PROHIBITED EQUIPMENT:",
    "SPORTSMANSHIP: ZERO-TOLERANCE POLICY",
    "Safety/Weight Considerations:",
    "Field Dimensions:",
]
TACKLE_TITLES = {
    "GAME PLAY:": "Game Play",
    "The Clock will be stopped for the following reasons:": "Clock Stoppages",
    "SPECIAL TEAMS:": "Special Teams",
    "POINT SYSTEM:": "Point System",
    "SUBSTITUTION / PLAY RULE:": "Substitution / Play Rule",
    "REQUIRED and PROHIBITED EQUIPMENT:": "Required & Prohibited Equipment",
    "SPORTSMANSHIP: ZERO-TOLERANCE POLICY": "Sportsmanship: Zero-Tolerance Policy",
    "Safety/Weight Considerations:": "Safety / Weight Considerations",
    "Field Dimensions:": "Field Dimensions",
}

def parse_tackle():
    text = open(os.path.join(RAW, "tackle.txt")).read()
    hdr_norm = {norm(h): h for h in TACKLE_HEADERS}
    sections, cur = [], None
    buf = []
    def flush():
        nonlocal buf, cur
        if cur is not None:
            cur["text"] = collapse_blanks("\n".join(buf))
        buf = []
    for ln in text.split("\n"):
        ln = ln.replace("\f", "")
        s = ln.strip()
        if not s:
            buf.append("")
            continue
        if s == "2025 Season" or re.fullmatch(r"\d{1,3}", s):
            continue
        if norm(s) in hdr_norm:
            flush()
            raw = hdr_norm[norm(s)]
            title = TACKLE_TITLES[raw]
            cur = {"title": title, "id": slug(title), "text": ""}
            sections.append(cur)
            continue
        if cur is not None:
            buf.append(ln)
    flush()
    for sec in sections:
        if sec["id"] == "field-dimensions" and not sec["text"]:
            sec["text"] = ("Field dimensions for the Sophomore 6-man tackle field are set by the "
                           "league at the field each game day. Beyond the unique rules in this document, "
                           "game play is governed by TAPPS 6 Man and NCAA football rules.")
    groups = [{"title": "SOPHOMORE 6-MAN TACKLE RULES", "id": "tackle",
               "sections": sections}]
    full = []
    for sec in sections:
        full.append(sec["title"])
        if sec["text"]:
            full.append(sec["text"])
    return groups, collapse_blanks("\n\n".join(full))

# ---------- FRESHMAN PROVISIONS ----------
FRESHMAN_PROVISIONS = [
    ("Field Width", "40 yards (vs 53 1/3 yards)"),
    ("Defensive Coach on Field", "Allowed only for Freshman."),
    ("Delay of Game Penalty", "More lenient during the regular season."),
    ("No-Run Zone", "Eliminated."),
    ("Illegal Forward Pass", "If the quarterback is throwing the ball away under pressure and the ball is not in the vicinity of a receiver, it is not a penalty as long as the quarterback made a good-faith attempt to throw the ball in the vicinity of a receiver."),
    ("Legal Blitzing", "Not allowed."),
    ("Passing Clock", "Five-second clock (due to no blitzing allowed)."),
]

def main():
    flag_groups, flag_full = parse_flag()
    tackle_groups, tackle_full = parse_tackle()

    prov_text = "FRESHMAN DIVISION PROVISIONS (adjustments to the flag rules)\n\n" + \
        "\n".join(f"- {k}: {v}" for k, v in FRESHMAN_PROVISIONS)

    data = {
        "updated": "As of August 1, 2026",
        "divisions": {
            "flag-older": {
                "id": "flag-older",
                "format": "Flag",
                "label": "Flag Football — Sophomore / Junior / Senior",
                "short": "Flag · Older divisions",
                "intro": "Standard SFL Flag Football rules for Sophomore (3rd–4th), Junior (5th–6th) and Senior (7th–8th) divisions.",
                "groups": flag_groups,
                "fullText": flag_full,
            },
            "flag-freshman": {
                "id": "flag-freshman",
                "format": "Flag",
                "label": "Flag Football — Freshman (1st–2nd grade)",
                "short": "Flag · Freshman",
                "intro": "SFL Flag Football rules with the Freshman Division adjustments applied. The provisions below override the standard rules where they differ.",
                "provisions": [{"label": k, "text": v} for k, v in FRESHMAN_PROVISIONS],
                "groups": flag_groups,
                "fullText": prov_text + "\n\n" + flag_full,
            },
            "tackle-sophomore": {
                "id": "tackle-sophomore",
                "format": "Tackle",
                "label": "Sophomore 6-Man Tackle",
                "short": "Tackle · Sophomore",
                "intro": "SFL Sophomore 6-Man Tackle Football rules (2025). Beyond the unique rules here, play is governed by TAPPS 6 Man and NCAA rules; conduct follows the SFL Flag Official Rulebook.",
                "groups": tackle_groups,
                "fullText": tackle_full,
            },
        },
        "order": ["flag-freshman", "flag-older", "tackle-sophomore"],
    }

    js = ("/* AUTO-GENERATED from the official SFL rulebook PDFs by data/build_rules.py.\n"
          "   Do not edit by hand — re-run the builder when a rulebook changes. */\n"
          "const SFL_RULES = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
          "if (typeof module !== 'undefined' && module.exports) module.exports = SFL_RULES;\n"
          "if (typeof window !== 'undefined') window.SFL_RULES = SFL_RULES;\n")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(js)

    # quick report
    print("FLAG groups:", len(flag_groups),
          "sections:", sum(len(g["sections"]) for g in flag_groups))
    for g in flag_groups:
        print("  -", g["title"], "->", [s["id"] for s in g["sections"]])
    print("TACKLE sections:", [s["id"] for s in tackle_groups[0]["sections"]])
    print("flag_full chars:", len(flag_full), "| tackle_full chars:", len(tackle_full))
    print("wrote", os.path.abspath(OUT))

if __name__ == "__main__":
    main()
