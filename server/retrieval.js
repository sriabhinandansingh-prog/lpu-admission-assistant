/* Retrieval over data/knowledge.json.
   No dependencies: builds a flat chunk index once at boot, scores by token
   overlap with light stemming, returns the top matches. */

const fs = require('fs');
const path = require('path');

const STOP = new Set(('a an the is are was were be been being of for to in on at by with from and or ' +
  'do does did can could should would will i me my we our you your it its this that these those ' +
  'what which who how when where why tell know about please give').split(' '));

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097F\u0A00-\u0A7F\s.]/g, ' ')
    .split(/\s+/)
    .map(t => t.replace(/\.$/, ''))
    .filter(t => t.length > 1 && !STOP.has(t));
}

function stem(t) {
  return t.replace(/(ing|ed|es|s)$/, '');
}

let CHUNKS = [];

function buildChunks(kb) {
  const chunks = [];
  const push = (id, kind, title, text, link) => {
    chunks.push({ id, kind, title, text, link, tokens: new Set(tokenize(title + ' ' + text).map(stem)) });
  };

  push('uni', 'university', kb.university.name + ' overview',
    `${kb.university.name} was established in ${kb.university.established} at ${kb.university.location}. ${kb.university.campus} Schools and disciplines: ${kb.university.schools.join(', ')}.`,
    kb.links.university);

  for (const p of kb.programmes) {
    push('prog-' + p.id, 'programme', p.name,
      `${p.name}. Level ${p.level}. Duration ${p.duration}. School ${p.school}. Eligibility: ${p.eligibility} Relevant subjects: ${p.subjects.join(', ')}. Entrance requirement: ${p.entrance}.`,
      kb.links.university);
  }

  push('policy-fees', 'policy', 'Fees, tuition, cost and charges',
    'Fees: no verified fee figures are stored here. Tuition fees, hostel charges and other charges are billed separately and depend on the programme, the specialisation and the academic session. Scholarship deductions are shown separately from the base fee. The current fee for a programme must be read on the admission portal for the session you are applying to, or confirmed with a counsellor.',
    kb.links.admissions);

  push('policy-status', 'policy', 'Application status and tracking',
    'Application status: this assistant cannot check, verify or confirm an application, a document upload or a payment. Only the official admission portal can show the status of an application, and payments must be made only through that portal.',
    kb.links.admissions);

  push('policy-placements', 'policy', 'Placements, jobs and packages',
    'Placements: the university publishes placement reports, but no package figure or placement rate is stored here, and outcomes differ sharply by programme and year. No university can guarantee a placement. Ask a counsellor for the report for the specific programme rather than a campus-wide average.',
    kb.links.university);

  push('policy-contact', 'policy', 'Contact details and address',
    'Contact: use the official admission portal and university website. The university is at Phagwara, Punjab, on the Jalandhar-Delhi GT Road. Raise queries through the official portal so they are logged.',
    kb.links.admissions);

  push('steps', 'admission', 'Admission process',
    'Admission process step by step: ' + kb.admission_steps.map((s, i) => `${i + 1}) ${s}`).join(' '),
    kb.links.admissions);

  push('policy-scholarships', 'policy', 'Scholarships overview and categories',
    'Scholarships: LPU offers academic merit scholarships based on qualifying examination marks, LPUNEST score based scholarships, consideration for national level examinations such as JEE Main, NEET, CAT, MAT and CLAT where accepted, sports scholarships for recognised state, national or international level records, cultural scholarships assessed by audition or portfolio, and financial assistance for specific categories as defined in the current official policy. No scholarship amount or slab percentage is stored here because the slabs change every session.',
    kb.links.admissions);

  for (const s of kb.scholarships) {
    push('sch-' + s.name.toLowerCase().replace(/\s+/g, '-'), 'scholarship', s.name + ' scholarship',
      `${s.name} scholarship: ${s.detail}`, kb.links.admissions);
  }

  push('hostel', 'hostel', 'Hostel and campus facilities',
    'Hostel and residential facilities: ' + kb.hostel.join(' '), kb.links.university);

  for (const f of kb.faqs) {
    push('faq-' + f.q.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40), 'faq', f.q, `${f.q} ${f.a}`, kb.links.admissions);
  }

  return chunks;
}

function loadIndex(kbPath) {
  const kb = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
  CHUNKS = buildChunks(kb);
  return { kb, count: CHUNKS.length };
}

/* A query about fees, status, placements or the application steps should reach
   the matching policy note even when a programme name scores equally. */
const INTENT_BOOST = [
  { id: 'policy-fees', re: /\b(fee|fees|cost|tuition|price|charges?|kharcha|kitni)\b/i },
  { id: 'policy-status', re: /\b(status|track|application status|check my application)\b/i },
  { id: 'policy-placements', re: /\b(placement|placements|package|salary|job|naukri)\b/i },
  { id: 'policy-scholarships', re: /\b(scholarship|scholarships|concession|financial aid|chhatravriti|freeship)\b/i },
  { id: 'steps', re: /\b(apply|application|procedure|process|steps|how to apply|form|register)\b/i }
];

function retrieve(query, limit = 4) {
  const q = tokenize(query).map(stem);
  if (!q.length) return [];
  const boosted = new Set(INTENT_BOOST.filter(b => b.re.test(query)).map(b => b.id));
  const scored = CHUNKS.map(c => {
    let score = 0;
    for (const t of q) {
      if (c.tokens.has(t)) score += 2;
      else if ([...c.tokens].some(ct => ct.startsWith(t) || t.startsWith(ct))) score += 1;
    }
    if (boosted.has(c.id)) score += 6;
    return { chunk: c, score };
  }).filter(s => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.chunk);
}

module.exports = { loadIndex, retrieve, tokenize };
