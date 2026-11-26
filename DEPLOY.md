# Deploying the LPU Admission AssistAI backend

The site on GitHub Pages is static, so it cannot hold a model key or run the retrieval service. This backend is the small piece that does both. It is one Docker image, no dependencies, and it runs on a free tier.

Until you deploy it, the site still works: it falls back to its bundled knowledge base.

## What you need

1. A host account (Render, Railway or Fly, all have free tiers).
2. A model endpoint and key, if you want model-written answers instead of retrieval-only. Any OpenAI-compatible `/v1/chat/completions` URL works.

You can deploy with **no key at all**. The backend then answers directly from `data/knowledge.json`, which is still a complete assistant, just more templated.

## Option A: Render (simplest)

1. Push this repo to GitHub (already done).
2. In Render, choose **New → Blueprint** and pick the repo. It reads `render.yaml`.
3. When prompted, paste `MODEL_API_KEY`, `MODEL_ENDPOINT` and `MODEL_NAME`. Skip them to start in retrieval-only mode.
4. Wait for the first build. The service URL looks like `https://lpu-assistai-backend.onrender.com`.

Free Render services sleep after inactivity, so the first request after a quiet spell takes a few seconds.

## Option B: Railway

1. **New Project → Deploy from GitHub repo**, pick the repo. It reads `railway.json` and builds the `Dockerfile`.
2. Add the same variables under **Variables**.
3. **Settings → Networking → Generate Domain**.

## Option C: Fly

```bash
fly launch --copy-config --no-deploy   # keeps fly.toml
fly secrets set MODEL_API_KEY=... MODEL_ENDPOINT=... MODEL_NAME=...
fly deploy
```

## Check it

```bash
curl https://YOUR-URL/api/health
```

You want `"ok":true` and the mode you expect:

- `"mode":"retrieval"` and `"identity":"retrieval-only"` means no key, knowledge-base answers.
- `"mode":"model"` means the model endpoint is wired up.

Then ask it something:

```bash
curl -X POST https://YOUR-URL/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"question":"I want B.Tech admission"}'
```

That should come back with the one-question-at-a-time follow-up, not a wall of text.

## Point the site at it

Open the live site, click **Settings**, and paste the service URL into **Backend URL**. The key stays on the server. Visitors never see it.

The browser keeps the URL in local storage, so it is per-device. To make it the default for every visitor instead, set `DEFAULT_BACKEND` at the top of `app.js` to that URL and redeploy.

## About the model

`MODEL_DISPLAY_NAME` is what the assistant calls itself. Leave it empty until the endpoint genuinely serves NVIDIA Nemotron 3.5 Bolt E4B, then set it to that name. A 4GB model is small enough to serve from a single GPU box with vLLM or llama.cpp:

```bash
# vLLM on a GPU machine, OpenAI-compatible out of the box
vllm serve YOUR-MODEL-ID --port 8000
# then MODEL_ENDPOINT=http://GPU-HOST:8000/v1/chat/completions
```

If the model lives on your own machine, the host must be able to reach it. Put both on the same network, or expose it through a tunnel, rather than opening a port to the internet.

## Troubleshooting

- **CORS error in the browser console.** `ALLOWED_ORIGIN` must be exactly the site origin, `https://sriabhinandansingh-prog.github.io`, with no trailing slash.
- **`401` or `403` from the model.** The key or endpoint is wrong. The health endpoint tells you whether a key is even set.
- **Model answers ignore the rules.** The system prompt is `prompts/system_prompt.txt` and is loaded at boot. Edit it and redeploy; there is only one copy.
- **Answers look templated after you set a key.** The endpoint responded with an error and the backend fell back to retrieval. Check the logs.

---

## Option 0: Base44 function (already live)

The backend is deployed at:

```
https://superagent-c912e94b.base44.app/functions/lpuAssist
```

`GET` returns health and the data-trust summary. `POST` with `{"question": "..."}` answers.

It is retrieval-only, so it needs no model key. To switch on model-written answers, save `MODEL_API_KEY`, `MODEL_ENDPOINT` and `MODEL_NAME` as app secrets, then redeploy `base44/lpuAssist.ts` with the model branch enabled (the file at `functions/lpuAssist.ts` in the agent workspace is the deployed source).

The site already points here: `DEFAULT_BACKEND` in `app.js` is set to this URL, so every visitor uses it with no setup.
