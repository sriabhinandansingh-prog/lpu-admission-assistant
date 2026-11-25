# LPU Admission Assistant

An admission-counsellor chatbot for Lovely Professional University, with three layers that each do one job:

1. **A static site** on GitHub Pages: the chat interface, plus a bundled knowledge-base engine so it works with no server at all.
2. **A backend** (`server/`): retrieval over the knowledge base, then an optional model call with the key held server-side.
3. **A LoRA fine-tune kit** (`train/`): teaches the assistant *how* to answer (shape, language, refusals), not *what* is true.

**Live site:** https://sriabhinandansingh-prog.github.io/lpu-admission-assistant/

## Why the split

Fees, cutoffs, deadlines and scholarship slabs change every session. A fine-tuned model bakes them into weights and then confidently repeats last year's numbers. So:

- Facts come from `data/knowledge.json` through retrieval, where they can be corrected in one edit.
- The model, if you connect one, is constrained to answer only from the retrieved passages.
- The fine-tune only shapes behaviour: answer structure, language mirroring, and refusing to invent figures.

Nothing in this repo invents a fee. Every layer says "I do not have a verified figure" and links to https://admission.lpu.in/ instead.

## The static site

```
index.html              chat shell
styles.css              styling
app.js                  language detection, intent matching, answer builders, backend client
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
2. **Set `meta.verified` to `true` only after someone has checked every row against the official site.** `/api/health` reports this flag, so you can see at a glance whether the data is trustworthy.

After editing the knowledge base, rerun `node train/build_dataset.js` if you intend to retrain, and restart the backend so the index rebuilds.

## Limits

- Static hosting means no lead capture and no admin view. If counsellors need to receive enquiries, that needs a form endpoint or a database.
- The knowledge base is a starting structure, not an audited prospectus. Verify before putting this in front of real applicants.
- Not affiliated with or endorsed by Lovely Professional University. It is an independent guide that links to the official portal.
