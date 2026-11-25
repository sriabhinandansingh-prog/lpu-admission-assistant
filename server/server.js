#!/usr/bin/env node
/* LPU Admission Assistant - backend.
   Zero dependencies. Serves POST /api/chat: retrieves from the knowledge base,
   then either answers from it directly (no key) or asks a model to answer using
   it as the only source (key present, held server-side).

   Env:
     PORT              default 8787
     MODEL_API_KEY     optional. Without it the server runs in retrieval-only mode.
     MODEL_ENDPOINT    default https://api.openai.com/v1/chat/completions
     MODEL_NAME        default gpt-4o-mini
     ALLOWED_ORIGIN    default *  (set to your Pages URL in production)
     KB_PATH           default ../data/knowledge.json
     STATIC_DIR        optional. Serve the static site from the same process.
     RATE_LIMIT        requests per IP per 10 minutes, default 30
*/

const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadIndex, retrieve } = require('./retrieval');

const PORT = process.env.PORT || 8787;
const MODEL_API_KEY = process.env.MODEL_API_KEY || '';
const MODEL_ENDPOINT = process.env.MODEL_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
const MODEL_NAME = process.env.MODEL_NAME || 'gpt-4o-mini';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const RATE_LIMIT = Number(process.env.RATE_LIMIT || 30);
const KB_PATH = process.env.KB_PATH || path.join(__dirname, '..', 'data', 'knowledge.json');
const STATIC_DIR = process.env.STATIC_DIR || '';

let KB, CHUNK_COUNT;
try {
  const loaded = loadIndex(KB_PATH);
  KB = loaded.kb;
  CHUNK_COUNT = loaded.count;
} catch (err) {
  console.error('Could not load knowledge base at ' + KB_PATH + ': ' + err.message);
  process.exit(1);
}

const LINKS = KB.links;
const SYSTEM_PROMPT = [
  'You are the LPU Admission Assistant for Lovely Professional University, Phagwara, Punjab, India.',
  'Reply in the language the student used: English, Hindi, Hinglish or Punjabi.',
  '',
  'GROUNDING RULES - these override everything else:',
  '1. Answer only from the CONTEXT passages below.',
  '2. Never state a fee, cutoff, deadline or scholarship amount. Those are not in the context. Say you do not have a verified figure and point to ' + LINKS.admissions + '.',
  '3. If the context does not cover the question, say so plainly instead of guessing.',
  '4. Never guarantee admission, a scholarship or a placement.',
  '5. Never claim to check an application status, take a payment, or access the university database.',
  '',
  'FORMAT: a direct answer, then key details as short bullets, then the next step, then the official link.',
  'Official links: university ' + LINKS.university + ' | admissions ' + LINKS.admissions
].join('\n');

/* ---------- rate limiting ---------- */
const hits = new Map();
const WINDOW_MS = 10 * 60 * 1000;

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip) || { count: 0, reset: now + WINDOW_MS };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + WINDOW_MS;
  }
  entry.count += 1;
  hits.set(ip, entry);
  return entry.count > RATE_LIMIT;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of hits) if (now > e.reset) hits.delete(ip);
}, 60000).unref();

/* ---------- helpers ---------- */
function send(res, status, body, extraHeaders = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  }, extraHeaders));
  res.end(payload);
}

function readBody(req, limit = 32000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

function retrievalAnswer(chunks) {
  if (!chunks.length) {
    return [
      '**Answer:** I do not have a verified answer for that in my knowledge base.',
      '',
      '**Important details:**',
      '- I answer only from a fixed set of LPU programme, admission, scholarship and hostel notes.',
      '- I would rather say so than invent a detail.',
      '',
      '**Next step:** Try asking about a specific course, eligibility, scholarships or the admission process, or check the official portal.',
      '',
      '**Official link:** ' + LINKS.admissions
    ].join('\n');
  }
  const top = chunks[0];
  const extra = chunks.slice(1, 3).map(c => `- Also relevant: ${c.title}`).join('\n');
  return [
    '**Answer:** ' + top.text,
    '',
    '**Important details:**',
    '- Source: ' + top.kind + ' notes, no verified fee or cutoff figures are stored.',
    extra,
    '',
    '**Next step:** Confirm the current fee and dates for your programme on the official portal.',
    '',
    '**Official link:** ' + (top.link || LINKS.admissions)
  ].filter(Boolean).join('\n');
}

async function modelAnswer(question, chunks, history) {
  const context = chunks.map((c, i) => `[${i + 1}] (${c.kind}) ${c.title}: ${c.text}`).join('\n\n') || '(no relevant context found)';
  const messages = [{ role: 'system', content: SYSTEM_PROMPT + '\n\nCONTEXT:\n' + context }];
  for (const m of (history || []).slice(-8)) {
    if (m && m.role && m.content) messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 2000) });
  }
  messages.push({ role: 'user', content: question });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(MODEL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + MODEL_API_KEY },
      body: JSON.stringify({ model: MODEL_NAME, temperature: 0.3, max_tokens: 700, messages }),
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error('Model HTTP ' + res.status + ' ' + text.slice(0, 200));
    }
    const data = await res.json();
    const out = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!out) throw new Error('Empty model response');
    return out.trim();
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- static files (optional) ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const filePath = path.join(STATIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(path.resolve(STATIC_DIR))) return send(res, 403, 'Forbidden');
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();

  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (req.url === '/api/health') {
    return send(res, 200, {
      ok: true,
      mode: MODEL_API_KEY ? 'model' : 'retrieval',
      model: MODEL_API_KEY ? MODEL_NAME : null,
      chunks: CHUNK_COUNT,
      session: KB.meta && KB.meta.session,
      verified: KB.meta && KB.meta.verified
    });
  }

  if (req.url === '/api/chat') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
    if (rateLimited(ip)) return send(res, 429, { error: 'Too many requests. Try again in a few minutes.' });

    let body;
    try {
      body = JSON.parse(await readBody(req) || '{}');
    } catch (err) {
      return send(res, 400, { error: 'Invalid JSON body' });
    }

    const question = String(body.question || '').trim().slice(0, 1000);
    if (!question) return send(res, 400, { error: 'question is required' });

    const chunks = retrieve(question, 4);

    if (!MODEL_API_KEY) {
      return send(res, 200, { mode: 'retrieval', answer: retrievalAnswer(chunks), sources: chunks.map(c => c.id) });
    }

    try {
      const answer = await modelAnswer(question, chunks, body.history);
      return send(res, 200, { mode: 'model', answer, sources: chunks.map(c => c.id) });
    } catch (err) {
      console.error('model call failed:', err.message);
      return send(res, 200, {
        mode: 'retrieval-fallback',
        answer: retrievalAnswer(chunks),
        warning: 'Model unavailable, answered from the knowledge base instead.',
        sources: chunks.map(c => c.id)
      });
    }
  }

  if (STATIC_DIR && req.method === 'GET') return serveStatic(req, res);
  return send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log('LPU Admission Assistant backend on http://localhost:' + PORT);
  console.log('  mode: ' + (MODEL_API_KEY ? 'model (' + MODEL_NAME + ')' : 'retrieval-only (no MODEL_API_KEY set)'));
  console.log('  knowledge chunks: ' + CHUNK_COUNT);
  console.log('  cors origin: ' + ALLOWED_ORIGIN);
  if (STATIC_DIR) console.log('  serving static site from ' + STATIC_DIR);
});
