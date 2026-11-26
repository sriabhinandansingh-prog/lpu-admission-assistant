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
const PROMPT_PATH = process.env.PROMPT_PATH || path.join(__dirname, '..', 'prompts', 'system_prompt.txt');

/* The prompt names the model only when a real model is serving the reply.
   Set MODEL_DISPLAY_NAME once the backend is actually pointed at that model,
   so the assistant never claims to be a model that is not answering. */
function loadSystemPrompt() {
  const raw = fs.readFileSync(PROMPT_PATH, 'utf8');
  const identity = process.env.MODEL_DISPLAY_NAME || (MODEL_API_KEY ? MODEL_NAME : '');
  const modelLine = identity ? 'Your AI model is ' + identity + '.' : '';
  return raw
    .replace('{{MODEL_LINE}}', modelLine)
    .replace('{{UNIVERSITY_LINK}}', LINKS.university)
    .replace('{{ADMISSIONS_LINK}}', LINKS.admissions)
    .replace('{{SCHOLARSHIPS_LINK}}', LINKS.scholarships)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

let SYSTEM_PROMPT = '';
try {
  SYSTEM_PROMPT = loadSystemPrompt();
} catch (err) {
  console.error('Could not load the system prompt at ' + PROMPT_PATH + ': ' + err.message);
  process.exit(1);
}

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

/* One question at a time, same rule the frontend and the prompt follow:
   a stated goal gets the single most useful follow-up, not a page of text. */
const GOAL_RE = /(admission|\u0926\u093e\u0916\u093f\u0932\u093e|\u0A26\u0A3E\u0A16\u0A32\u0A3E|chahiye|lena|apply karna)/i;
const DETAIL_RE = /(about|know|details|information|batao|bataiye|jankari|ke baare|eligible|eligib|fee|fees|hostel|placement|scholarship|how|when|where|process|procedure)/i;

/* Match the programme the student actually named, not whichever programme
   chunk happened to score first. */
function findProgramme(question) {
  const q = ' ' + question.toLowerCase().replace(/[^a-z0-9\u0900-\u097F\u0A00-\u0A7F ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const squash = q.replace(/ /g, '');
  const aliases = {
    btech: ['b.tech', 'btech', 'b tech', 'engineering'],
    bca: ['bca'],
    bba: ['bba'],
    bcom: ['b.com', 'bcom', 'b com'],
    bsc: ['b.sc', 'bsc', 'b sc'],
    bdes: ['b.des', 'bdes'],
    bpharm: ['b.pharm', 'bpharm', 'pharmacy'],
    llb: ['llb', 'law'],
    mba: ['mba'],
    mca: ['mca'],
    mtech: ['m.tech', 'mtech'],
    msc: ['m.sc', 'msc'],
    phd: ['phd', 'doctorate'],
    diploma: ['diploma']
  };
  let best = null;
  let bestLen = 0;
  for (const prog of KB.programmes) {
    const keys = (aliases[prog.id] || [prog.name.toLowerCase()]).concat([prog.name.toLowerCase()]);
    for (const k of keys) {
      const needle = k.replace(/ /g, '');
      if (!needle) continue;
      const hit = squash.includes(needle) || q.includes(' ' + k + ' ');
      if (hit && needle.length > bestLen) {
        best = prog;
        bestLen = needle.length;
      }
    }
  }
  return best;
}

function goalFollowUp(question, chunks) {
  if (!GOAL_RE.test(question) || DETAIL_RE.test(question)) return null;
  const prog = findProgramme(question);
  if (!prog) return null;
  if (prog.level === 'Doctoral') return "Great! Have you completed your master's degree?";
  if (prog.level === 'PG') return "Great! Have you completed your bachelor's degree?";
  if (prog.level === 'Diploma') return 'Great! Are you in Class 10 or Class 12 right now?';
  return 'Great! Are you currently studying in Class 12, or have you already completed it?';
}

function retrievalAnswer(chunks) {
  if (!chunks.length) {
    return [
      'I do not have a verified answer for that in my knowledge base.',
      '',
      '- I answer only from a fixed set of LPU programme, admission, scholarship and hostel notes.',
      '- I would rather say so than invent a detail.',
      '',
      'Next step: try asking about a specific course, eligibility, scholarships or the admission process.',
      '',
      'Official link: ' + LINKS.admissions
    ].join('\n');
  }
  const top = chunks[0];
  const extra = chunks.slice(1, 3).map(c => `- Also relevant: ${c.title}`).join('\n');
  return [
    top.text,
    '',
    '- Source: ' + top.kind + ' notes. No verified fee or cutoff figures are stored here.',
    extra,
    '',
    'Next step: confirm the current fee and dates for your programme on the official portal.',
    '',
    'Official link: ' + (top.link || LINKS.admissions)
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
      assistant: 'LPU Admission AssistAI',
      identity: process.env.MODEL_DISPLAY_NAME || (MODEL_API_KEY ? MODEL_NAME : 'retrieval-only'),
      session: KB.meta && KB.meta.session,
      verified: KB.meta && KB.meta.verified,
      verified_sections: (KB.meta && KB.meta.verified_sections) || [],
      unverified_sections: (KB.meta && KB.meta.unverified_sections) || [],
      last_checked: KB.meta && KB.meta.last_checked
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
      const follow = goalFollowUp(question, chunks);
      return send(res, 200, {
        mode: 'retrieval',
        answer: follow || retrievalAnswer(chunks),
        sources: chunks.map(c => c.id)
      });
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
  console.log('  assistant: LPU Admission AssistAI | prompt: ' + PROMPT_PATH);
  console.log('  knowledge chunks: ' + CHUNK_COUNT);
  console.log('  cors origin: ' + ALLOWED_ORIGIN);
  if (STATIC_DIR) console.log('  serving static site from ' + STATIC_DIR);
});
