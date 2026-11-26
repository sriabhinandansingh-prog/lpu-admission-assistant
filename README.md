# LPU Admission AssistAI

LPU Admission AssistAI: an admission-counsellor chatbot for Lovely Professional University, with three layers that each do one job:

1. **A static site** on GitHub Pages: the chat interface, plus a bundled knowledge-base engine so it works with no server at all.
2. **A backend** (`server/`): retrieval over the knowledge base, then an optional model call with the key held server-side.
3. **A LoRA fine-tune kit** (`train/`): teaches the assistant *how* to answer (shape, language, refusals), not *what* is true.

**Live site:** https://sriabhinandansingh-prog.github.io/lpu-admission-assistant/

## Deploying

`DEPLOY.md` covers the whole path: Render (one-click blueprint via `render.yaml`), Railway (`railway.json`) or Fly (`fly.toml`), each building the same `Dockerfile`. All three can run with no model key at all, in retrieval-only mode.

```bash
docker build -t lpu-assistant .
docker run -p 8787:8787 --env-file .env lpu-assistant
curl localhost:8787/api/health
```

Then paste the service URL into the live site's Settings, or set `DEFAULT_BACKEND` in `app.js` to make it the default for every visitor.

## Fine-tuning

`train/colab_finetune.ipynb` runs the whole thing on a free Colab T4: install, rebuild the dataset, train the LoRA adapter, and a set of refusal tests that must pass before you deploy it. The script itself is `train/train_lora.py`.

## The system prompt

`prompts/system_prompt.txt` is the single source of truth for the assistant's instructions: identity, the four languages, the one-question-at-a-time conversation rule, the accuracy rules, response style and the official links. The backend and the dataset builder both load that file, so there is one prompt to edit, not three copies.

It uses three placeholders: `{{MODEL_LINE}}`, and the university, admissions and scholarships links. The model line stays empty unless a real model is serving replies, so the assistant never claims to be a model that is not answering. Once the backend is actually pointed at one, set `MODEL_DISPLAY_NAME`:

```bash
MODEL_API_KEY=... MODEL_NAME=nvidia/nemotron-3.5-bolt-e4b MODEL_DISPLAY_NAME="NVIDIA Nemotron 3.5 Bolt E4B" node server/server.js
```

## Why the split

Fees, cutoffs, deadlines and scholarship slabs change every session. A fine-tuned model bakes them into weights and then confidently repeats last year's numbers. So:

- Facts come from `data/knowledge.json` through retrieval, where they can be corrected in one edit.
- The model, if you connect one, is constrained to answer only from the retrieved passages.
- The fine-tune only shapes behaviour: answer structure, language mirroring, and refusing to invent figures.

Nothing in this repo invents a fee. Every layer says "I do not have a verified figure" and links to https://admission.lpu.in/ instead.

## Live verification (every answer is checked, not just written)

A knowledge base is a snapshot; a university site is not. So the assistant now browses before it answers and checks after it answers.

1. **Browse.** `base44/lpuVerify.ts` fetches `admission.lpu.in`, the scholarship page and `lpu.in` at request time and pulls out the lines that actually change: what is open, what is closing, the scholarship headline, the session. Those lines go into the model's context, so "is admission open" is answered from today's site instead of "I do not know".
2. **Answer.** The model writes the reply from the retrieved notes plus those live lines, and is told not to extend them.
3. **Verify.** The finished reply goes back to the same function. Every amount, percentage, date, phone number, email and link in it is matched against the text that was just fetched from the official pages (and, failing that, against the knowledge base). The reply is then labelled:

| Verdict | Meaning |
| --- | --- |
| `verified` | Every figure in the reply was found on an official page minutes ago |
| `partly_verified` | Some figures come only from the knowledge base, not from a live page |
| `unverified` | A figure was not found anywhere official and is listed by name |
| `unavailable` | The official pages could not be reached, so nothing was checked |

The site shows that label, the pages it checked and the time of the check under every reply, so a student can see what is confirmed and what is not.

Endpoints:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/functions/lpuVerify` | GET | which official pages are reachable right now, plus today's live lines |
| `/functions/lpuVerify` | POST `{ question }` | live context only, used before answering |
| `/functions/lpuVerify` | POST `{ answer }` | the check: verdict, checked figures, unverified claims, unofficial links |
| `/functions/lpuChat` | POST `{ question, history }` | browse → answer → verify, returns `{ answer, live_signals, verification }` |

Deploying `lpuChat` yourself needs `NVIDIA_API_KEY` saved as an app secret; without it the function still runs, in retrieval-only mode, and every reply is still verified. `lpuVerify` needs no secret at all.

## Scope: an admission assistant, not a general chatbot

Ask it "what is AI" and it answers like a person, not like a search box:

> Straight answer: I'm the LPU admission assistant, not a personal or general-purpose chatbot, so that one is outside what I handle.
> What I do know properly is LPU: courses, eligibility, fees, scholarships, hostel and the admission process.
> Which of those can I help you with?

Three things make that work:

- `app.js` checks scope before calling the backend, so an unrelated question never pulls up a programme page that happened to share a keyword. Short answers inside a live conversation ("yes", "78%", "class 12") stay in scope, and a bare answer is sent with the question it is replying to.
- The reply comes in the student's language (English, Hindi, Hinglish, Punjabi), and the off-topic reply is still sent to the verification API, so the badge under it is honest: no facts to check.
- `prompts/system_prompt.txt` carries the same rule for the model, and `base44/lpuAssist.ts` carries it for the retrieval-only path, so a self-hosted deployment behaves the same way.

## The static site

```
index.html              chat shell
styles.css              styling
app.js                  language detection, intent matching, answer builders, backend client
base44/lpuVerify.ts     live browse + verification of every reply
base44/lpuChat.ts       model layer: browse, answer, verify
data/knowledge.json     the knowledge base - edit this, not the JS
.nojekyll               tells Pages to serve files as-is
```

Run it locally over HTTP, not as a `file://` path:

```bash
python3 -m http.server 8000
```

By default it answers from the bundled knowledge base with no network calls. Open **Settings** to point it at a backend.

## The backend

Zero dependencies, plain Node. It builds a retrieval index over `data/knowledge.json` at boot and exposes one endpoint.

```bash
node server/server.js
# LPU Admission Assistant backend on http://localhost:8787
```

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/health` | GET | mode, model, chunk count, session, whether the data is verified |
| `/api/chat` | POST | `{ "question": "...", "history": [...] }` → `{ mode, answer, sources }` |

Two modes:

- **No `MODEL_API_KEY`**: retrieval-only. It composes an answer straight from the matching knowledge-base passages. Free, deterministic, no vendor.
- **With `MODEL_API_KEY`**: it retrieves the top passages and asks the model to answer using only those, with the key never leaving the server. If the model call fails, it falls back to the retrieval answer rather than an error.

Config lives in `server/.env.example`. Includes per-IP rate limiting (30 requests / 10 min by default) and CORS locked by `ALLOWED_ORIGIN`.

### Deploying it

GitHub Pages cannot run this, because Pages is static hosting only. Any container host works:

```bash
docker build -t lpu-assistant .
docker run -p 8787:8787 -e MODEL_API_KEY=... lpu-assistant
```

That image runs on Render, Railway, Fly.io, a VPS, or Cloud Run. Once it has a public URL, open the live site, go to **Settings**, paste the URL, and the site switches to backend mode. The Dockerfile also serves the static site, so a single container gives you the whole app at one URL.

## The fine-tune

```bash
node train/build_dataset.js     # 154 chat-format records, 4 languages, 8% held out
python train/train_lora.py --model Qwen/Qwen2.5-0.5B-Instruct --out out/lpu-lora
```

`build_dataset.js` merges 26 hand-written behaviour examples in `train/seed_examples.jsonl` with programme and eligibility examples generated from the knowledge base, so every programme is covered in English, Hindi, Hinglish and Punjabi.

`train_lora.py` uses LoRA with prompt-token masking, so the loss only covers the assistant's answer. It needs a GPU; a free Colab T4 handles a 0.5B-1B base model.

**This script was written and syntax-checked but never executed.** This sandbox has no GPU and no torch, so expect to tune epochs and learning rate on real hardware, and verify the refusal behaviour survives training before you deploy it.

## Updating the knowledge base

Everything factual lives in `data/knowledge.json`. Add a programme by copying an entry in the `programmes` array.

Two rules worth keeping:

1. **Do not add fee numbers, cutoffs or deadlines unless you have verified them on admission.lpu.in for the current session.** The assistant is built to say it does not know rather than guess, and that is a feature.
2. **Track what has actually been checked.** `meta.verified_sections` lists what was read from an official page and when (`meta.last_checked`); `meta.unverified_sections` lists what is deliberately absent. `/api/health` reports all three, so you can see the state of the data at a glance. Set `meta.verified` to `true` only when nothing is left in the unverified list.

Current state: scholarship categories, bracket criteria and admission phases were read from https://www.lpu.in/scholarship/scholarship.php on 2026-11-26. Fees, cutoffs and deadlines are still absent by design.

After editing the knowledge base, rerun `node train/build_dataset.js` if you intend to retrain, and restart the backend so the index rebuilds.

## Limits

- Static hosting means no lead capture and no admin view. If counsellors need to receive enquiries, that needs a form endpoint or a database.
- The knowledge base is a starting structure, not an audited prospectus. Verify before putting this in front of real applicants.
- Not affiliated with or endorsed by Lovely Professional University. It is an independent guide that links to the official portal.
