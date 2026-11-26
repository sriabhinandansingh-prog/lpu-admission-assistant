/**
 * LPU Admission AssistAI - model layer.
 *
 * POST /functions/lpuChat { question, history? }
 * Retrieval comes from /functions/lpuAssist (the sourced knowledge base);
 * this function has nvidia/nemotron-3.5-bolt-e4b write the reply from those
 * notes, in the student's language, under prompts/system_prompt.txt.
 * If anything fails it returns the retrieval answer unchanged.
 */
const RETRIEVAL = "https://superagent-c912e94b.base44.app/functions/lpuAssist";
const PROMPT_URL = "https://raw.githubusercontent.com/sriabhinandansingh-prog/lpu-admission-assistant/main/prompts/system_prompt.txt";
const MODEL = "nvidia/nemotron-3.5-bolt-e4b";
const MODEL_DISPLAY = "NVIDIA Nemotron 3.5 Bolt E4B";
const ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};
let promptCache: { text: string; at: number } | null = null;

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function systemPrompt(): Promise<string> {
  if (promptCache && Date.now() - promptCache.at < 600000) return promptCache.text;
  const res = await fetch(PROMPT_URL);
  const raw = await res.text();
  const text = raw
    .replace("{{MODEL_LINE}}", "Your AI model is " + MODEL_DISPLAY + ".")
    .replace("{{UNIVERSITY_LINK}}", "https://www.lpu.in/")
    .replace("{{ADMISSIONS_LINK}}", "https://admission.lpu.in/")
    .replace("{{SCHOLARSHIPS_LINK}}", "https://www.lpu.in/scholarship/scholarship.php");
  promptCache = { text, at: Date.now() };
  return text;
}

const NATIVE: [RegExp, string][] = [
  [/ਹੋਸਟਲ/g, "hostel"], [/हॉस्टल/g, "hostel"],
  [/ਫੀਸ/g, "fees"], [/फीस/g, "fees"], [/ਸ਼ੁਲਕ/g, "fees"], [/शुल्क/g, "fees"],
  [/ਸਕਾਲਰਸ਼ਿਪ/g, "scholarship"], [/छਾਤਰਵ੍ਰਿੱਤਿ/g, "scholarship"], [/छात्रवृत्ति/g, "scholarship"], [/स्कॉलरशिप/g, "scholarship"],
  [/ਦਾਖਲਾ|ਦਾਖਲੇ/g, "admission"], [/दाखिला|दाखिले/g, "admission"], [/ਐਡਮਿਸ਼ਨ/g, "admission"], [/एडमिशन/g, "admission"],
  [/ਯੋਗਤਾ/g, "eligibility"], [/योग्यता|पात्रता/g, "eligibility"],
  [/ਕੋਰਸ/g, "course"], [/कोर्स/g, "course"],
  [/ਪਲੇਸਮੈਂਟ/g, "placement"], [/प्लेसमेंट/g, "placement"],
  [/ਪ੍ਰੋਗਰਾਮ/g, "programme"], [/प्रोग्राम/g, "programme"],
  [/ਬੀ\.ਟੈਕ/g, "btech"], [/बी\.टेक/g, "btech"],
  [/ਐਮ\.ਬੀ\.ਏ/g, "mba"], [/एम\.बी\.ए/g, "mba"],
  [/ਬੀ\.ਸੀ\.ਏ/g, "bca"], [/बी\.सी\.ए/g, "bca"],
  [/ਕੈਂਪਸ/g, "campus"], [/कैंपस/g, "campus"],
  [/ਪਲੇਸਮੈਂਟ/g, "placement"],
  [/ਵਜ਼ੀਫ਼ਾ/g, "scholarship"], [/ਵਜੀਫਾ/g, "scholarship"],
  [/ਦਾਖਲ/g, "admission"], [/दाखल/g, "admission"],
];

function normalize(s: string): string {
  let t = s;
  for (const [re, en] of NATIVE) t = t.replace(re, en);
  return t;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const key = Deno.env.get("NVIDIA_API_KEY") || "";

  if (req.method === "GET") {
    return json({ ok: true, assistant: "LPU Admission AssistAI", mode: key ? "model" : "retrieval", model: key ? MODEL : null, identity: key ? MODEL_DISPLAY : "retrieval-only" });
  }
  if (req.method !== "POST") return json({ error: "Use GET or POST." }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const q = String(body.question || body.q || "").trim();
    if (!q) return json({ error: "Send { question: '...' }." }, 400);
    if (q.length > 1500) return json({ error: "Question too long." }, 413);

    const rRes = await fetch(RETRIEVAL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: normalize(q) }),
    });
    const r = await rRes.json().catch(() => ({}));
    const notes = String(r.answer || "").trim();
    const sources = r.sources || [];
    if (!key || !notes) return json({ answer: notes || "Backend unavailable.", mode: "retrieval", sources });
    if (!sources.length) return json({ answer: notes, mode: "retrieval", sources });

    const messages: any[] = [
      { role: "system", content: await systemPrompt() },
      { role: "system", content: "Use only these LPU notes for facts. If the answer is not in them, say so plainly and offer the official link.\n\nNOTES:\n" + notes },
    ];
    for (const m of (Array.isArray(body.history) ? body.history : []).slice(-8)) {
      if ((m.role === "user" || m.role === "assistant") && m.content) {
        messages.push({ role: m.role, content: String(m.content).slice(0, 1500) });
      }
    }
    messages.push({ role: "user", content: q });

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, temperature: 0.3, max_tokens: 600, messages }),
    });
    if (!res.ok) return json({ answer: notes, mode: "retrieval", sources, note: "model HTTP " + res.status });
    const d = await res.json();
    const t = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    if (!t || !String(t).trim()) return json({ answer: notes, mode: "retrieval", sources });
    return json({ answer: String(t).trim(), mode: "model", model: MODEL, sources });
  } catch (e) {
    return json({ error: "Backend error: " + String((e as Error).message || e) }, 500);
  }
});
