/**
 * LPU Admission AssistAI - live backend endpoint (retrieval-only build).
 *
 * POST /functions/lpuAssist  { "question": "..." }
 * GET  /functions/lpuAssist  -> health and data-trust summary
 *
 * Answers come straight from the public knowledge base in the GitHub repo, so
 * there is no model key to leak and no fee is ever invented. Editing
 * data/knowledge.json updates this endpoint within ten minutes.
 *
 * Model-written answers are the next step: they need MODEL_API_KEY,
 * MODEL_ENDPOINT and MODEL_NAME saved as app secrets, which this build does
 * not reference so it can run with none.
 */

const REPO = "https://raw.githubusercontent.com/sriabhinandansingh-prog/lpu-admission-assistant/main";
const KB_URL = REPO + "/data/knowledge.json";
const CACHE_MS = 10 * 60 * 1000;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

type Chunk = { id: string; kind: string; title: string; text: string; link: string };

const STOP = new Set([
  "the", "a", "an", "is", "are", "was", "were", "do", "does", "did", "of", "to", "in", "on",
  "for", "and", "or", "i", "you", "me", "my", "we", "it", "this", "that", "what", "which",
  "can", "could", "should", "would", "how", "when", "where", "who", "with", "about", "tell",
  "give", "please", "want", "need", "there", "be", "have", "has", "any", "at", "by", "from",
]);

function tokenize(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9. ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

const stem = (t: string) => t.replace(/(ing|ed|es|s)$/, "");

function buildChunks(kb: any): Chunk[] {
  const chunks: Chunk[] = [];
  const links = kb.links || {};
  const push = (id: string, kind: string, title: string, text: string, link?: string) => {
    if (text) chunks.push({ id, kind, title, text, link: link || links.admissions || "" });
  };

  const u = kb.university || {};
  push("uni", "university", "University overview",
    [u.name, u.established, u.location, u.campus].filter(Boolean).join(". "), links.university);

  for (const p of kb.programmes || []) {
    push("prog-" + p.id, "programme", p.name,
      `${p.name}. Level ${p.level}. Duration ${p.duration}. School ${p.school}. ` +
      `Eligibility: ${p.eligibility} Relevant subjects: ${p.subjects}. ` +
      `Entrance requirement: ${p.entrance}.`, p.url || links.university);
  }

  if (kb.admission_steps) {
    push("steps", "process", "Admission process",
      "Admission process step by step: " +
      kb.admission_steps.map((s: any, i: number) => `${i + 1}) ${s.text || s}`).join(" "),
      links.admissions);
  }

  for (const s of kb.scholarships || []) {
    push("sch-" + String(s.name).toLowerCase().replace(/[^a-z0-9]+/g, "-"), "scholarship",
      s.name, `${s.name}: ${s.detail}`, s.source_url || links.scholarships);
  }

  const sb = kb.scholarship_brackets || {};
  const phases = (kb.scholarship_phases && kb.scholarship_phases.detail) || "";
  const a12 = sb.after_12th_diploma_lateral || [];
  const agr = sb.after_graduation || [];
  if (a12.length) {
    push("policy-scholarships", "policy", "Scholarships overview and brackets",
      `Scholarships: ${(kb.scholarships || []).map((s: any) => s.name).join("; ")}. ` +
      `Brackets after Class 12, diploma or lateral entry: ${a12.join(", ")}. ` +
      `Brackets after graduation: ${agr.join(", ")}. ` +
      `${phases} The concession amount per bracket is not published and differs by programme.`,
      links.scholarships);
  }

  for (const h of kb.hostel || []) {
    push("hostel", "hostel", "Hostel and residential facilities", h.text || h, links.university);
  }

  for (const f of kb.faqs || []) {
    push("faq-" + String(f.q).toLowerCase().replace(/[^a-z0-9]+/g, "-"), "faq", f.q,
      `${f.q} ${f.a}`, f.link);
  }

  push("policy-fees", "policy", "Fees, tuition, cost and charges",
    "Fees: no verified fee figures are stored here. Tuition fees, hostel charges and other charges " +
    "are billed separately and depend on the programme and the academic session. Scholarship " +
    "deductions are shown separately. Open the admission portal, select the programme and read the " +
    "fee section for the current session.", links.admissions);

  push("policy-status", "policy", "Application status",
    "Application status: this assistant cannot check, verify or confirm an application, a document " +
    "upload or a payment. Only the official admission portal shows the real status of an application.",
    links.admissions);

  push("policy-placements", "policy", "Placements and packages",
    "Placements: the university publishes placement reports, but no package figure or placement rate " +
    "is stored here, and outcomes differ sharply by programme and year.", links.university);

  return chunks;
}

const BOOSTS: { re: RegExp; id: string }[] = [
  { re: /\b(fee|fees|cost|tuition|price|charge|kharcha|kitni)\b/i, id: "policy-fees" },
  { re: /\b(status|track|application status)\b/i, id: "policy-status" },
  { re: /\b(placement|package|salary|job)\b/i, id: "policy-placements" },
  { re: /\b(apply|application|admission process|procedure|steps|form|dakhila)\b/i, id: "steps" },
  { re: /\b(scholarship|concession|financial aid|scholarships)\b/i, id: "policy-scholarships" },
];

function retrieve(question: string, chunks: Chunk[], limit = 4): Chunk[] {
  const q = tokenize(question).map(stem);
  if (!q.length) return [];
  const boostIds = new Set(BOOSTS.filter((b) => b.re.test(question)).map((b) => b.id));
  return chunks
    .map((c) => {
      const toks = tokenize(c.title + " " + c.text).map(stem);
      let score = 0;
      for (const t of q) if (toks.some((ct) => ct === t || ct.startsWith(t) || t.startsWith(ct))) score += 2;
      if (boostIds.has(c.id)) score += 6;
      return { c, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.c);
}

const ALIAS: Record<string, string[]> = {
  btech: ["b.tech", "btech", "b tech", "engineering"],
  bca: ["bca"], bba: ["bba"],
  bcom: ["b.com", "bcom", "b com"],
  bsc: ["b.sc", "bsc", "b sc"],
  ba: ["b.a", "ba"],
  bdes: ["b.des", "bdes"],
  bpharm: ["b.pharm", "bpharm", "pharmacy"],
  llb: ["llb", "law"],
  mba: ["mba"], mca: ["mca"],
  mtech: ["m.tech", "mtech"],
  msc: ["m.sc", "msc"],
  ma: ["m.a", "ma"],
  phd: ["phd", "doctorate"],
  diploma: ["diploma"],
};

/* Longest alias wins, so "mba" is never read as "ba" and "bba" not as "ba". */
function programmeInQuestion(question: string, kb: any) {
  const t = " " + question.toLowerCase().replace(/[^a-z0-9. ]/g, " ").replace(/\s+/g, " ") + " ";
  const squash = t.replace(/ /g, "");
  let best: any = null;
  let bestLen = 0;
  for (const p of kb.programmes || []) {
    const keys = (ALIAS[p.id] || []).concat([String(p.name).toLowerCase()]);
    for (const k of keys) {
      const needle = k.replace(/ /g, "");
      if (!needle) continue;
      if ((squash.includes(needle) || t.includes(" " + k + " ")) && needle.length > bestLen) {
        best = p;
        bestLen = needle.length;
      }
    }
  }
  return best;
}

function goalFollowUp(question: string, kb: any, chunks: Chunk[]): string | null {
  const GOAL = /(admission|दाखिला|ਦਾਖਲਾ|chahiye|lena|apply karna)/i;
  const DETAIL = /(about|know|details|information|batao|bataiye|jankari|ke baare|eligible|fee|fees|hostel|placement|scholarship|process|duration|how long)/i;
  if (!GOAL.test(question) || DETAIL.test(question)) return null;
  const prog = programmeInQuestion(question, kb);
  if (!prog) return null;
  if (prog.level === "Doctoral") return "Great! Have you completed your master's degree?";
  if (prog.level === "PG") return "Great! Have you completed your bachelor's degree?";
  if (prog.level === "Diploma") return "Great! Are you in Class 10 or Class 12 right now?";
  return "Great! Are you currently studying in Class 12, or have you already completed it?";
}

function answerFrom(chunks: Chunk[], links: any): string {
  const top = chunks[0];
  const fallbackLink = links.admissions || "https://admission.lpu.in/";
  if (!top) {
    return "I don't have a verified answer for that in my knowledge base.\n\n" +
      "- I answer from a fixed set of LPU programme, admission, scholarship and hostel notes.\n" +
      "- I would rather say so than invent a detail.\n\n" +
      "Next step: try asking about a course or the admission process, or check the official portal.\n\n" +
      "Official link: " + fallbackLink;
  }
  return top.text + "\n\nNext step: confirm the current fee and dates for your programme on the official portal.\n\n" +
    "Official link: " + (top.link || fallbackLink);
}

let cache: { at: number; kb: any; chunks: Chunk[] } | null = null;

async function load() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const res = await fetch(KB_URL, { headers: { "Cache-Control": "no-cache" } });
  if (!res.ok) throw new Error("knowledge base fetch failed: " + res.status);
  const kb = await res.json();
  cache = { at: Date.now(), kb, chunks: buildChunks(kb) };
  return cache;
}

/* ---------- scope ----------
   An admission assistant, not a general chatbot. An off-topic question gets a
   short, human answer about what this assistant actually does - never a
   programme chunk that happened to share a keyword. */
const SCOPE =
  /(lpu|lpunest|admission|admit|apply|application|dakhila|दाखिला|ਦਾਖਲ|course|programme|program\b|branch|stream|specialis|specializ|subject|semester|session|fee|fees|शुल्क|फीस|ਫੀਸ|kharcha|cost|scholarship|schol|छात्रवृत्ति|ਸਕਾਲਰਸ਼ਿਪ|hostel|mess|accommodation|हॉस्टल|ਹੋਸਟਲ|rehna|eligib|योग्यता|ਯੋਗਤਾ|entrance|jee|neet|cat\b|gate\b|clat|placement|internship|package|naukri|campus|library|sports|club|contact|helpline|email|address|cutoff|deadline|last date|result|counselling|counsel|seat|intake|b\.?tech|btech|bca|bba|b\.?com|bcom|b\.?sc|bsc|bdes|bpharm|pharm|llb|law|mba|mca|m\.?tech|mtech|m\.?sc|msc|phd|doctorate|diploma|cse|ece|eee|mechanical|civil|aiml|artificial intelligence|data science|cyber|cloud|lateral|detain|attendance|document|migration)/i;

const SCOPE_REPLY: Record<string, string> = {
  en: "Straight answer: I'm the LPU admission assistant, not a personal or general-purpose chatbot, so that one is outside what I handle.\n\nWhat I do know properly is LPU: courses, eligibility, fees, scholarships, hostel and the admission process.\n\nWhich of those can I help you with?",
  hi: "सीधा जवाब: मैं LPU का admission assistant हूँ, कोई personal या general chatbot नहीं, इसलिए यह मेरे काम का हिस्सा नहीं है।\n\nजो मुझे ठीक से पता है वह LPU है: कोर्स, पात्रता, फीस, छात्रवृत्ति, हॉस्टल और दाखिला प्रक्रिया।\n\nइनमें से किसमें मदद करूँ?",
  hinglish: "Seedha jawab: main LPU ka admission assistant hoon, koi personal ya general chatbot nahi, isliye yeh mere kaam ka hissa nahi hai.\n\nJo mujhe theek se pata hai wo LPU hai: courses, eligibility, fees, scholarship, hostel aur admission process.\n\nInme se kis cheez me madad karun?",
  pa: "ਸਿੱਧਾ ਜਵਾਬ: ਮੈਂ LPU ਦਾ admission assistant ਹਾਂ, ਕੋਈ personal ਜਾਂ general chatbot ਨਹੀਂ, ਇਸ ਲਈ ਇਹ ਮੇਰੇ ਕੰਮ ਦਾ ਹਿੱਸਾ ਨਹੀਂ।\n\nਜੋ ਮੈਨੂੰ ਠੀਕ ਤਰ੍ਹਾਂ ਪਤਾ ਹੈ ਉਹ LPU ਹੈ: ਕੋਰਸ, ਯੋਗਤਾ, ਫੀਸ, ਸਕਾਲਰਸ਼ਿਪ, ਹੋਸਟਲ ਅਤੇ ਦਾਖਲਾ ਪ੍ਰਕਿਰਿਆ।\n\nਇਨ੍ਹਾਂ ਵਿੱਚੋਂ ਕਿਸ ਵਿੱਚ ਮਦਦ ਕਰਾਂ?",
};

function languageOf(text: string): string {
  if (/[\u0A00-\u0A7F]/.test(text)) return "pa";
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  if (/\b(kya|kaise|kitni|kitna|hai|hain|nahi|mera|mujhe|batao|chahiye|karna|hoga|kaun|kab|kahan|bhai|krna|bta)\b/i.test(text)) return "hinglish";
  return "en";
}

/* A bare answer to the assistant's own follow-up ("yes", "78%", "class 12")
   carries no keywords of its own, so it is not treated as off-topic. */
const CONTINUATION =
  /^(yes|yeah|yep|ya|haan|ha|han|ok|okay|no|nahi|nah|nope|sure|thik|theek|class\s?1[02](th)?|1[02]th|graduation|graduate|bachelor|master|diploma|lateral|pcm|pcb|science|commerce|arts|20\d\d|\d{1,3}\s?%?)\s*[.!]?$/i;

function scopeReply(question: string): string | null {
  if (SCOPE.test(question)) return null;
  if (CONTINUATION.test(question.trim())) return null;
  return SCOPE_REPLY[languageOf(question)] || SCOPE_REPLY.en;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  let data: { kb: any; chunks: Chunk[] };
  try {
    data = await load();
  } catch (err) {
    return json({ error: "Could not load the knowledge base", detail: String(err) }, 502);
  }

  const { kb, chunks } = data;
  const links = kb.links || {};
  const meta = kb.meta || {};

  if (req.method === "GET") {
    return json({
      ok: true,
      assistant: "LPU Admission AssistAI",
      mode: "retrieval",
      chunks: chunks.length,
      session: meta.session,
      verified_sections: meta.verified_sections || [],
      unverified_sections: meta.unverified_sections || [],
      last_checked: meta.last_checked,
    });
  }

  if (req.method !== "POST") return json({ error: "Use POST with { question }" }, 405);

  let question = "";
  try {
    const body = await req.json();
    question = String(body.question || "").slice(0, 1000).trim();
  } catch {
    return json({ error: 'Body must be JSON like { "question": "..." }' }, 400);
  }
  if (!question) return json({ error: "Ask a question in the 'question' field" }, 400);

  const scope = scopeReply(question);
  if (scope) return json({ answer: scope, mode: "retrieval", sources: [] });

  const hits = retrieve(question, chunks);
  const follow = goalFollowUp(question, kb, hits);
  if (follow) return json({ answer: follow, mode: "retrieval", sources: hits.map((h) => h.id) });

  return json({ answer: answerFrom(hits, links), mode: "retrieval", sources: hits.map((h) => h.id) });
});
