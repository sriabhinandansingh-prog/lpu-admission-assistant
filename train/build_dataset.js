#!/usr/bin/env node
/* Builds chat-format training data for the LPU Admission Assistant.
   Sources: train/seed_examples.jsonl (hand-written behaviour examples) plus
   programme and policy examples generated from data/knowledge.json.

   What this teaches: answer shape, language mirroring, refusal behaviour.
   What this does NOT teach: facts. Fees and cutoffs stay in retrieval, because
   a fine-tune cannot be updated when the session changes.

   Usage: node train/build_dataset.js  ->  train/train.jsonl, train/valid.jsonl
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'knowledge.json'), 'utf8'));

const PROMPT_TEMPLATE = fs.readFileSync(path.join(ROOT, 'prompts', 'system_prompt.txt'), 'utf8');

/* The canonical prompt, minus the model-identity line: a fine-tune should not
   learn to name a specific provider's model. */
const SYSTEM = PROMPT_TEMPLATE
  .replace('{{MODEL_LINE}}', '')
  .replace('{{UNIVERSITY_LINK}}', KB.links.university)
  .replace('{{ADMISSIONS_LINK}}', KB.links.admissions)
  .replace('{{SCHOLARSHIPS_LINK}}', KB.links.scholarships)
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const LINKS = KB.links;

const L = {
  en: {
    detail: (p) => `**Answer:** Here is what I have for ${p.name}.\n\n**Important details:**\n- **Level:** ${p.level}\n- **Duration:** ${p.duration}\n- **School:** ${p.school}\n- **Eligibility:** ${p.eligibility}\n- **Relevant subjects:** ${p.subjects.join(', ')}\n- **Entrance:** ${p.entrance}\n\n**Next step:** Confirm the current fee and dates for this programme on the portal.\n\n**Official link:** ${LINKS.university}`,
    detailQ: (p) => `Tell me about ${p.name}`,
    elig: (p) => `**Verdict:** Needs official verification. I can state the criteria, but I cannot confirm your admission.\n\n**Important details:**\n- **Programme:** ${p.name} (${p.duration})\n- **Stated requirement:** ${p.eligibility}\n- **Relevant subjects:** ${p.subjects.join(', ')}\n- **Entrance:** ${p.entrance}\n- The final decision is the university's, based on your documents.\n\n**Next step:** Compare your marks against the requirement, then confirm with a counsellor.\n\n**Official link:** ${LINKS.university}`,
    eligQ: (p) => `Am I eligible for ${p.name}?`
  },
  hi: {
    detail: (p) => `**उत्तर:** ${p.name} की जानकारी।\n\n**महत्वपूर्ण जानकारी:**\n- **स्तर:** ${p.level}\n- **अवधि:** ${p.duration}\n- **स्कूल:** ${p.school}\n- **पात्रता:** ${p.eligibility}\n- **विषय:** ${p.subjects.join(', ')}\n- **प्रवेश परीक्षा:** ${p.entrance}\n\n**अगला कदम:** वर्तमान फीस और तिथियाँ पोर्टल पर पुष्टि करें।\n\n**आधिकारिक लिंक:** ${LINKS.university}`,
    detailQ: (p) => `${p.name} के बारे में बताइए`,
    elig: (p) => `**निर्णय:** आधिकारिक सत्यापन आवश्यक है। मैं नियम बता सकता हूँ, दाखिले की पुष्टि नहीं कर सकता।\n\n**महत्वपूर्ण जानकारी:**\n- **प्रोग्राम:** ${p.name} (${p.duration})\n- **आवश्यकता:** ${p.eligibility}\n- **विषय:** ${p.subjects.join(', ')}\n- **प्रवेश परीक्षा:** ${p.entrance}\n- अंतिम निर्णय विश्वविद्यालय का होगा।\n\n**अगला कदम:** अपने अंक आवश्यकता से मिलाएँ और पुष्टि करें।\n\n**आधिकारिक लिंक:** ${LINKS.university}`,
    eligQ: (p) => `क्या मैं ${p.name} के लिए योग्य हूँ?`
  },
  hinglish: {
    detail: (p) => `**Answer:** ${p.name} ki jankari.\n\n**Important details:**\n- **Level:** ${p.level}\n- **Duration:** ${p.duration}\n- **School:** ${p.school}\n- **Eligibility:** ${p.eligibility}\n- **Subjects:** ${p.subjects.join(', ')}\n- **Entrance:** ${p.entrance}\n\n**Next step:** Current fee aur dates portal par confirm karo.\n\n**Official link:** ${LINKS.university}`,
    detailQ: (p) => `${p.name} ke baare me batao`,
    elig: (p) => `**Verdict:** Official verification chahiye. Main criteria bata sakta hoon, admission confirm nahi kar sakta.\n\n**Important details:**\n- **Programme:** ${p.name} (${p.duration})\n- **Requirement:** ${p.eligibility}\n- **Subjects:** ${p.subjects.join(', ')}\n- **Entrance:** ${p.entrance}\n- Final decision university ka hoga.\n\n**Next step:** Apne marks requirement se match karo, phir counsellor se confirm karo.\n\n**Official link:** ${LINKS.university}`,
    eligQ: (p) => `kya main ${p.name} ke liye eligible hoon`
  },
  pa: {
    detail: (p) => `**ਜਵਾਬ:** ${p.name} ਦੀ ਜਾਣਕਾਰੀ।\n\n**ਜ਼ਰੂਰੀ ਜਾਣਕਾਰੀ:**\n- **ਸਤਰ:** ${p.level}\n- **ਸਮਾਂ:** ${p.duration}\n- **ਸਕੂਲ:** ${p.school}\n- **ਯੋਗਤਾ:** ${p.eligibility}\n- **ਵਿਸ਼ੇ:** ${p.subjects.join(', ')}\n- **ਪ੍ਰੀਖਿਆ:** ${p.entrance}\n\n**ਅਗਲਾ ਕਦਮ:** ਮੌਜੂਦਾ ਫੀਸ ਅਤੇ ਤਾਰੀਖਾਂ ਪੋਰਟਲ 'ਤੇ ਪੁਸ਼ਟੀ ਕਰੋ।\n\n**ਅਧਿਕਾਰਤ ਲਿੰਕ:** ${LINKS.university}`,
    detailQ: (p) => `${p.name} ਬਾਰੇ ਦੱਸੋ`,
    elig: (p) => `**ਨਤੀਜਾ:** ਅਧਿਕਾਰਤ ਪੁਸ਼ਟੀ ਲੋੜੀਂਦੀ ਹੈ। ਮੈਂ ਨਿਯਮ ਦੱਸ ਸਕਦਾ ਹਾਂ, ਦਾਖਲਾ ਪੱਕਾ ਨਹੀਂ ਕਰ ਸਕਦਾ।\n\n**ਜ਼ਰੂਰੀ ਜਾਣਕਾਰੀ:**\n- **ਪ੍ਰੋਗਰਾਮ:** ${p.name} (${p.duration})\n- **ਲੋੜ:** ${p.eligibility}\n- **ਵਿਸ਼ੇ:** ${p.subjects.join(', ')}\n- **ਪ੍ਰੀਖਿਆ:** ${p.entrance}\n\n**ਅਗਲਾ ਕਦਮ:** ਆਪਣੇ ਅੰਕ ਲੋੜ ਨਾਲ ਮਿਲਾਓ ਅਤੇ ਪੁਸ਼ਟੀ ਕਰੋ।\n\n**ਅਧਿਕਾਰਤ ਲਿੰਕ:** ${LINKS.university}`,
    eligQ: (p) => `ਕੀ ਮੈਂ ${p.name} ਲਈ ਯੋਗ ਹਾਂ?`
  }
};

const records = [];

function add(lang, user, assistant) {
  records.push({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
      { role: 'assistant', content: assistant }
    ],
    lang
  });
}

/* 1. hand-written behaviour seeds */
const seedPath = path.join(__dirname, 'seed_examples.jsonl');
if (fs.existsSync(seedPath)) {
  for (const line of fs.readFileSync(seedPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const d = JSON.parse(trimmed);
    add(d.lang || 'en', d.user, d.assistant);
  }
}

/* 2. programme detail and eligibility, every programme in every language */
for (const p of KB.programmes) {
  for (const lang of Object.keys(L)) {
    const t = L[lang];
    add(lang, t.detailQ(p), t.detail(p));
    add(lang, t.eligQ(p), t.elig(p));
  }
}

/* 3. shuffle deterministically so the split is reproducible */
let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
for (let i = records.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [records[i], records[j]] = [records[j], records[i]];
}

const validCount = Math.max(1, Math.round(records.length * 0.08));
const valid = records.slice(0, validCount);
const train = records.slice(validCount);

function write(file, rows) {
  fs.writeFileSync(file, rows.map(r => JSON.stringify({ messages: r.messages })).join('\n') + '\n');
}

write(path.join(__dirname, 'train.jsonl'), train);
write(path.join(__dirname, 'valid.jsonl'), valid);

const byLang = records.reduce((acc, r) => { acc[r.lang] = (acc[r.lang] || 0) + 1; return acc; }, {});
console.log('records total:', records.length);
console.log('train:', train.length, '| valid:', valid.length);
console.log('by language:', JSON.stringify(byLang));
console.log('programmes covered:', KB.programmes.length);
