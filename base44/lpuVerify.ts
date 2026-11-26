/**
 * LPU Admission AssistAI - live verification layer.
 *
 * GET  /functions/lpuVerify                 -> health: which pages are reachable, cache age
 * POST /functions/lpuVerify { question }    -> live context only (no answer to check)
 * POST /functions/lpuVerify { answer, question? }
 *      -> checks every figure, percentage, date, phone and link in an answer
 *         against the official LPU pages fetched live right now.
 *
 * Why this exists: the knowledge base in the repo is a snapshot. A student asks
 * "is admission open", "how much scholarship", "what is the last date" and the
 * honest answer changes week to week. So each reply is checked against
 * admission.lpu.in, the scholarship page and lpu.in at the moment it is sent,
 * and the reply is labelled: verified live, supported by the knowledge base
 * only, or not verified at all.
 *
 * Nothing is invented. If a figure cannot be found on an official page, it is
 * reported as unverified instead of being passed off as fact.
 */

const SOURCES = [
  { id: "admissions", url: "https://admission.lpu.in/" },
  { id: "scholarships", url: "https://www.lpu.in/scholarship/scholarship.php" },
  { id: "university", url: "https://www.lpu.in/" },
];

const KB_URL =
  "https://raw.githubusercontent.com/sriabhinandansingh-prog/lpu-admission-assistant/main/data/knowledge.json";

const CACHE_MS = 10 * 60 * 1000;
const UA = "Mozilla/5.0 (compatible; LPU-Admission-AssistAI/1.0; live-verification)";
const OFFICIAL_HOSTS = ["lpu.in"];

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

/* ---------- fetching ---------- */

type Page = {
  id: string;
  url: string;
  status: number;
  ok: boolean;
  fetched_at: string;
  bytes: number;
  text: string;
};

const pageCache: Record<string, { at: number; page: Page }> = {};
let kbCache: { at: number; text: string; ok: boolean } | null = null;

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&lt;": "<", "&gt;": ">",
  "&#8377;": "₹", "&rsquo;": "'", "&lsquo;": "'", "&ldquo;": '"', "&rdquo;": '"',
  "&ndash;": "-", "&mdash;": "-", "&#8211;": "-", "&#8212;": "-", "&#39;": "'",
};

function stripHtml(html: string): string {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  t = t.replace(/<[^>]+>/g, " ");
  for (const [k, v] of Object.entries(ENTITIES)) t = t.split(k).join(v);
  t = t.replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)));
  return t.replace(/\s+/g, " ").trim();
}

async function fetchPage(src: { id: string; url: string }): Promise<Page> {
  const hit = pageCache[src.id];
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.page;

  const page: Page = {
    id: src.id, url: src.url, status: 0, ok: false,
    fetched_at: new Date().toISOString(), bytes: 0, text: "",
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(src.url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
      signal: ctrl.signal,
    });
    page.status = res.status;
    if (res.ok) {
      const html = await res.text();
      page.bytes = html.length;
      page.text = stripHtml(html).slice(0, 160000);
      page.ok = page.text.length > 300;
    }
  } catch (_e) {
    page.status = -1;
  } finally {
    clearTimeout(timer);
  }
  pageCache[src.id] = { at: Date.now(), page };
  return page;
}

async function kbText(): Promise<{ text: string; ok: boolean }> {
  if (kbCache && Date.now() - kbCache.at < CACHE_MS) return kbCache;
  let text = "";
  let ok = false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(KB_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      text = stripHtml(await res.text());
      ok = text.length > 200;
    }
  } catch (_e) {
    ok = false;
  }
  kbCache = { at: Date.now(), text, ok };
  return kbCache;
}

/* ---------- live signals ----------
   Short, quotable lines from the official pages: what is open, what is closing,
   what the scholarship headline says today. These are the things the static
   knowledge base cannot know. */

const SIGNALS: { id: string; label: string; re: RegExp }[] = [
  { id: "lpunest", label: "LPUNEST", re: /Applications? for LPUNEST[^.]{0,100}/i },
  { id: "admission_window", label: "Admissions", re: /Applications? (?:are |is )?(?:now )?(?:open|closed)[^.]{0,90}/i },
  { id: "closing", label: "Closing soon", re: /(?:closing soon|last date|hurry up)[^.]{0,90}/i },
  { id: "scholarship_headline", label: "Scholarship headline", re: /(?:get up to \d+% scholarship[^.]{0,70}|up to ₹?\s?[\d.,]+ ?lakh scholarship[^.]{0,50})/i },
  { id: "session", label: "Session", re: /(?:session|admissions?)\s?20\d\d\s?[-–]\s?\d\d[^.]{0,40}/i },
];

function liveSignals(pages: Page[]): { id: string; label: string; text: string; url: string }[] {
  const out: { id: string; label: string; text: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    if (!page.ok) continue;
    for (const sig of SIGNALS) {
      const m = page.text.match(sig.re);
      if (!m) continue;
      const text = m[0].replace(/\s+/g, " ").trim().slice(0, 180);
      const key = text.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: sig.id, label: sig.label, text, url: page.url });
    }
  }
  return out.slice(0, 6);
}

/* ---------- claim extraction ---------- */

type Claim = { claim: string; kind: string; norm: string };

const MONTHS: Record<string, string> = {
  january: "jan", february: "feb", march: "mar", april: "apr", may: "may", june: "jun",
  july: "jul", august: "aug", september: "sep", october: "oct", november: "nov", december: "dec",
  jan: "jan", feb: "feb", mar: "mar", apr: "apr", jun: "jun", jul: "jul", aug: "aug",
  sep: "sep", sept: "sep", oct: "oct", nov: "nov", dec: "dec",
};

function normText(s: string): string {
  let t = s.toLowerCase();
  t = t.replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\b/g, (m) => MONTHS[m] || m);
  t = t.replace(/[\u00a0]/g, " ");
  t = t.replace(/\brs\.?\b/g, "").replace(/\binr\b/g, "");
  t = t.replace(/₹/g, "");
  return t.replace(/[\s,]/g, "");
}

const CLAIM_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "amount", re: /(?:₹|Rs\.?|INR)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:lakh|lac|crore|thousand|k))?/gi },
  { kind: "amount", re: /\b\d[\d,]*(?:\.\d+)?\s?(?:lakh|lac|crore)\b/gi },
  { kind: "percent", re: /\b\d{1,3}(?:\.\d+)?\s?%/g },
  { kind: "date", re: /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{4}\b/gi },
  { kind: "date", re: /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g },
  { kind: "phone", re: /(?:\+91[\s-]?)?\b[6-9]\d{9}\b/g },
  { kind: "email", re: /[\w.+-]+@[\w-]+\.[a-z.]{2,}/gi },
];

function extractClaims(answer: string): Claim[] {
  const out: Claim[] = [];
  const seen = new Set<string>();
  for (const p of CLAIM_PATTERNS) {
    const matches = answer.match(p.re) || [];
    for (const raw of matches) {
      const claim = raw.trim();
      const norm = normText(claim);
      if (norm.length < 2 || seen.has(p.kind + "|" + norm)) continue;
      seen.add(p.kind + "|" + norm);
      out.push({ claim, kind: p.kind, norm });
    }
  }
  return out;
}

function extractLinks(answer: string): string[] {
  return (answer.match(/https?:\/\/[^\s<>()"']+/gi) || []).map((u) => u.replace(/[.,)]+$/, ""));
}

function isOfficial(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch (_e) {
    return false;
  }
}

/* ---------- verification ---------- */

const IST = "Asia/Calcutta";

function istStamp(d = new Date()): string {
  try {
    return d.toLocaleString("en-IN", {
      timeZone: IST, day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    }) + " IST";
  } catch (_e) {
    return d.toISOString();
  }
}

type VerifyResult = {
  verdict: "verified" | "partly_verified" | "unverified" | "unavailable" | "nothing_to_check";
  checked_at: string;
  checked_at_local: string;
  sources: { id: string; url: string; status: number; ok: boolean; fetched_at: string; bytes: number }[];
  live_signals: { id: string; label: string; text: string; url: string }[];
  claims: {
    total: number;
    live: number;
    knowledge_base_only: number;
    unverified: { claim: string; kind: string }[];
  };
  links: { total: number; unofficial: string[] };
  headline: string;
};

async function verifyAnswer(answer: string): Promise<VerifyResult> {
  const [pages, kb] = await Promise.all([
    Promise.all(SOURCES.map((s) => fetchPage(s))),
    kbText(),
  ]);

  const liveText = normText(pages.filter((p) => p.ok).map((p) => p.text).join(" \n "));
  const kbNorm = normText(kb.text);
  const liveOk = pages.some((p) => p.ok);

  const claims = extractClaims(answer);
  const live: Claim[] = [];
  const kbOnly: Claim[] = [];
  const missing: Claim[] = [];
  for (const c of claims) {
    if (liveOk && liveText.includes(c.norm)) live.push(c);
    else if (kb.ok && kbNorm.includes(c.norm)) kbOnly.push(c);
    else missing.push(c);
  }

  const links = extractLinks(answer);
  const unofficial = links.filter((u) => !isOfficial(u));

  let verdict: VerifyResult["verdict"];
  if (!liveOk) verdict = "unavailable";
  else if (missing.length) verdict = "unverified";
  else if (!claims.length && !links.length) verdict = "nothing_to_check";
  else if (kbOnly.length) verdict = "partly_verified";
  else verdict = "verified";

  const checkedAt = new Date();
  const sourceLine = pages.filter((p) => p.ok).map((p) => new URL(p.url).hostname).join(", ");

  let headline: string;
  if (verdict === "verified") {
    headline = claims.length
      ? `Every figure in this reply (${claims.length}) was found on ${sourceLine} just now.`
      : `Links checked against ${sourceLine} just now.`;
  } else if (verdict === "partly_verified") {
    headline = `${kbOnly.length} figure(s) come from the assistant's knowledge base, not from a live official page: ${kbOnly.map((c) => c.claim).join(", ")}.`;
  } else if (verdict === "unverified") {
    headline = `Not found on the official pages: ${missing.map((c) => c.claim).join(", ")}. Treat these as unconfirmed.`;
  } else if (verdict === "unavailable") {
    headline = "The official LPU pages could not be reached, so this reply was not live-checked.";
  } else {
    headline = `No figures or dates to check. Sources were reachable: ${sourceLine}.`;
  }
  if (unofficial.length) headline += ` Unofficial link(s): ${unofficial.join(", ")}.`;

  return {
    verdict,
    checked_at: checkedAt.toISOString(),
    checked_at_local: istStamp(checkedAt),
    sources: pages.map((p) => ({
      id: p.id, url: p.url, status: p.status, ok: p.ok,
      fetched_at: p.fetched_at, bytes: p.bytes,
    })),
    live_signals: liveSignals(pages),
    claims: {
      total: claims.length,
      live: live.length,
      knowledge_base_only: kbOnly.length,
      unverified: missing.map((c) => ({ claim: c.claim, kind: c.kind })),
    },
    links: { total: links.length, unofficial },
    headline,
  };
}

/* ---------- handler ---------- */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (req.method === "GET") {
    const pages = await Promise.all(SOURCES.map((s) => fetchPage(s)));
    return json({
      ok: true,
      layer: "live-verification",
      checked_at_local: istStamp(),
      sources: pages.map((p) => ({
        id: p.id, url: p.url, status: p.status, ok: p.ok, bytes: p.bytes, fetched_at: p.fetched_at,
      })),
      live_signals: liveSignals(pages),
    });
  }

  if (req.method !== "POST") return json({ error: "Use GET or POST." }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const answer = String(body.answer || body.text || "").trim().slice(0, 8000);

    if (!answer) {
      const pages = await Promise.all(SOURCES.map((s) => fetchPage(s)));
      const signals = liveSignals(pages);
      return json({
        ok: true,
        mode: "context",
        checked_at_local: istStamp(),
        sources: pages.map((p) => ({
          id: p.id, url: p.url, status: p.status, ok: p.ok, fetched_at: p.fetched_at,
        })),
        live_signals: signals,
        context: signals.length
          ? signals.map((s) => `[live ${s.url}] ${s.label}: ${s.text}`).join("\n")
          : "",
      });
    }

    const result = await verifyAnswer(answer);
    return json({ ok: true, mode: "verify", ...result });
  } catch (e) {
    return json({ ok: false, error: "Verification error: " + String((e as Error).message || e) }, 500);
  }
});
