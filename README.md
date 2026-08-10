# SFL Rules App

A lightweight web app for the **Southwest Football League** (sfltx.org). An admin
opens it, picks a league/division, and gets three tools scoped to that division's
official rulebook:

- **Ask** — an AI chat that answers rules questions, grounded *only* in the selected
  division's official rule text (via Claude).
- **Rules** — a browsable, searchable table of contents of the rulebook.
- **Suggest** — a form that emails a rule suggestion to the league board (via Resend).

Entry is a branching picker: **Flag** or **Tackle** → if Flag, **Freshman** (1st–2nd
grade, special provisions) or **Older** (Sophomore/Junior/Senior). Tackle goes straight
to the Sophomore 6-Man rules.

## How it's built

Zero build step, zero framework — deploys to Vercel exactly like a static site plus
two serverless functions. No `npm install` required.

```
index.html          The whole single-page app (HTML + Tailwind CDN + vanilla JS)
rules.js            Auto-generated rule data (browsable sections + chat grounding)
api/chat.js         Serverless fn: Claude chat, holds the Anthropic key server-side
api/suggest.js      Serverless fn: emails suggestions via Resend
data/build_rules.py Rebuilds rules.js from the official rulebook text
data/raw/*.txt      Plain-text extracts of the three PDFs (source of truth)
vercel.json         Function config
.env.example        The environment variables you need to set
```

## Deploy to Vercel

**Option A — Git (recommended, same as your recipe app):**
1. Push this folder to a GitHub repo.
2. In Vercel, "Add New → Project" and import the repo. No framework preset needed
   (it auto-detects: static site + `/api` functions).
3. Add the environment variables below (Settings → Environment Variables).
4. Deploy.

**Option B — Drag & drop / CLI:** run `vercel` from this folder (needs the Vercel CLI),
or drag the folder into the Vercel dashboard's new-project uploader.

## Environment variables

Copy from `.env.example` into your Vercel project settings:

| Variable | What it's for |
|---|---|
| `ANTHROPIC_API_KEY` | Powers the **Ask** chat. Get one at console.anthropic.com. |
| `ANTHROPIC_MODEL` | *(optional)* Override the model. Defaults to `claude-sonnet-4-5`. |
| `RESEND_API_KEY` | Powers the **Suggest** email. Free at resend.com. |
| `SUGGEST_TO` | Where suggestions are emailed (comma-separate for multiple). |
| `SUGGEST_FROM` | *(optional)* The "from" address. Use a Resend-verified domain; until then the default `onboarding@resend.dev` test sender works. |

The app degrades gracefully: if the chat or email keys aren't set yet, the relevant
tab shows a friendly "not set up yet" message instead of breaking.

## Updating the rules when a rulebook changes

1. Replace the matching file in `data/raw/` with a fresh `pdftotext -layout` extract
   (`flag.txt`, `freshman.txt`, or `tackle.txt`).
2. Run `python3 data/build_rules.py` to regenerate `rules.js`.
3. Redeploy. Both the lookup and the chat update from the same source.

## Branding

Colors and fonts live in one place at the top of `index.html`:
- the `tailwind.config` `colors` block and the `:root` CSS variables (`--navy`, `--brand`, `--gold`)
- the Google Fonts link (currently Oswald + Inter)

Swap those values for SFL's exact brand colors/fonts and the whole app updates.

## Notes

- Styling uses the Tailwind Play CDN for a no-build setup. That's fine for an internal
  tool; if you want a fully self-contained build with no external CDN, it can be
  compiled to a static stylesheet later.
- Deep links work: `?division=flag-freshman&tab=rules` opens straight to a division/tab.
- The AI chat is advisory; the printed rulebook and on-field officials are the final word.
