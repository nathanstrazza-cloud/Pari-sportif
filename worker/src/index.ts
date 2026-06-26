import {
  findLiveCandidates,
  findPostMatchCandidates,
  getApiFixtureId,
  mergeLiveFixtures,
  parseDate,
  type Match,
  type Fixture,
} from "./merge";

export interface Env {
  MATCHES: KVNamespace;
  API_FOOTBALL_KEY: string;
  WORLD_CUP_LEAGUE: string;
  WORLD_CUP_SEASON: string;
  ALLOWED_ORIGINS?: string;
  RESEED_HOUR_UTC?: string;
  SYNC_TOKEN?: string;
  // Binding de rate limiting Cloudflare (optionnel). Voir [[ratelimits]] dans wrangler.toml.
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  // Binding Workers AI (optionnel). Voir [ai] dans wrangler.toml.
  AI?: { run(model: string, input: Record<string, any>): Promise<any> };
}

// Cles KV (par environnement) :
//   matches:base    <- pousse par la passe Python (calendrier + scores finalises)
//   matches:current <- etat accumule par le Worker (live merge), c'est ce qui est servi
//   standings / players / odds <- pousses par Python, servis tels quels
const MATCHES_CURRENT = "matches:current";
const MATCHES_BASE = "matches:base";
const PASSTHROUGH_KEYS = new Set(["standings", "players", "odds", "cards"]);

const BEFORE_MS = 15 * 60 * 1000; // 15 min avant le coup d'envoi
const AFTER_MS = 135 * 60 * 1000; // fenetre live : jusqu'a ~135 min apres le coup d'envoi
// Apres-match : de +135 a +195 min (1h), on rattrape le score final toutes les 10 min.
const POST_AFTER_MS = 135 * 60 * 1000;
const POST_UNTIL_MS = 195 * 60 * 1000;
const POST_MATCH_EVERY_MIN = 10;
const DEFAULT_RESEED_HOUR = 11; // UTC, apres la passe Python du matin (cron 10h UTC)

// --- Generation des "Discussions de nos experts" via Workers AI ---
const EXPERT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const EXPERT_HORIZON_MS = 5 * 24 * 60 * 60 * 1000; // ne genere que pour les matchs des ~5 prochains jours
const EXPERT_BATCH = 4; // nb de matchs traites par passage du cron (limite la conso)
const EXPERT_SYSTEM = [
  "Tu es un panel de 5 consultants football francais pour un jeu de pronostics entre amis, sans argent.",
  "Tu produis EXACTEMENT 5 avis courts (2 a 3 phrases), en francais, ton convivial de fin connaisseur.",
  "Avis 1, 2 et 3 : sur le RESULTAT du match. Chacun finit par \"Parti pris : <equipe> gagne\" ou \"Parti pris : match nul\".",
  "Avis 4 et 5 : sur le SCORE EXACT. Chacun finit par \"Parti pris : Score exact - X - Y\".",
  "Varie les angles (talents, collectif, donnees, emotion, value). Interdit : paris d'argent, buteurs, nombre de buts, joueur decisif.",
  "Reponds UNIQUEMENT par un tableau JSON de 5 chaines de caracteres, sans texte autour.",
].join("\n");

function parseStringArray(text: string): string[] | null {
  const tryParse = (s: string) => {
    try {
      const j = JSON.parse(s);
      if (Array.isArray(j)) return j.map((x) => String(x).trim()).filter(Boolean);
    } catch {
      /* ignore */
    }
    return null;
  };
  return tryParse(text) ?? tryParse((text.match(/\[[\s\S]*\]/) || [""])[0]);
}

// Genere les 5 avis (3 resultat + 2 score) pour un match via Workers AI.
async function generateMatchExperts(env: Env, match: Match): Promise<string[] | null> {
  if (!env.AI) return null;
  const proba = match.winProbability;
  const probaTxt =
    proba && (proba.home != null || proba.draw != null || proba.away != null)
      ? ` Probabilites: ${match.home} ${proba.home ?? "?"}%, nul ${proba.draw ?? "?"}%, ${match.away} ${proba.away ?? "?"}%.`
      : "";
  const userMsg = `Match : ${match.home} vs ${match.away}.${match.stage ? ` Phase : ${match.stage}.` : ""}${probaTxt} Donne les 5 avis.`;
  try {
    const res = await env.AI.run(EXPERT_MODEL, {
      messages: [
        { role: "system", content: EXPERT_SYSTEM },
        { role: "user", content: userMsg },
      ],
      max_tokens: 700,
    });
    const text = typeof res === "string" ? res : res?.response ?? "";
    const arr = parseStringArray(String(text));
    return arr && arr.length >= 5 ? arr.slice(0, 5) : null;
  } catch {
    return null;
  }
}

// Genere les experts pour quelques matchs a venir qui n'en ont pas encore (limite EXPERT_BATCH).
async function maybeGenerateExperts(env: Env, data: Record<string, any>, nowMs: number, limit: number): Promise<number> {
  if (!env.AI) return 0;
  const matches: Match[] = Array.isArray(data.matches) ? data.matches : [];
  const todo = matches
    .filter((m) => {
      if (m.status !== "upcoming" || m.expertsAI) return false;
      const d = parseDate(m.date);
      return d !== null && d > nowMs && d - nowMs < EXPERT_HORIZON_MS;
    })
    .slice(0, limit);
  let generated = 0;
  for (const m of todo) {
    const experts = await generateMatchExperts(env, m);
    if (experts) {
      m.expertDiscussion = experts;
      m.expertsAI = true;
      generated += 1;
    }
  }
  return generated;
}

// Une origine est-elle autorisee ? (allowlist .fr + localhost + *.pages.dev)
function originAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (allowed.includes(origin)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true; // dev local
  if (/^https:\/\/([a-z0-9-]+\.)*pages\.dev$/.test(origin)) return true; // Cloudflare Pages
  return false;
}

// Origine effective de la requete : en-tete Origin, sinon l'origine du Referer.
function requestOriginOf(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (origin) return origin;
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function pickOrigin(request: Request, env: Env): string {
  const origin = requestOriginOf(request);
  if (originAllowed(origin, env)) return origin as string;
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
  return allowed[0] || "*";
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

async function readJson(env: Env, key: string): Promise<Record<string, any> | null> {
  const body = await env.MATCHES.get(key);
  if (!body) return null;
  try {
    return JSON.parse(body) as Record<string, any>;
  } catch {
    return null;
  }
}

async function fetchLiveFixtures(env: Env): Promise<Fixture[]> {
  const url =
    `https://v3.football.api-sports.io/fixtures?live=all` +
    `&league=${encodeURIComponent(env.WORLD_CUP_LEAGUE)}` +
    `&season=${encodeURIComponent(env.WORLD_CUP_SEASON)}`;
  const response = await fetch(url, {
    headers: { "x-apisports-key": env.API_FOOTBALL_KEY, Accept: "application/json" },
  });
  const payload = (await response.json()) as Record<string, any>;
  if (!response.ok) {
    throw new Error(`API-FOOTBALL ${response.status}: ${JSON.stringify(payload?.errors ?? payload)}`);
  }
  const errors = payload?.errors;
  const hasErrors = Array.isArray(errors) ? errors.length > 0 : errors && Object.keys(errors).length > 0;
  if (hasErrors) throw new Error(`API-FOOTBALL erreur: ${JSON.stringify(errors)}`);
  return (payload?.response as Fixture[]) ?? [];
}

// Recupere des fixtures precises par id (apres-match : le flux live=all ne renvoie plus un match termine).
async function fetchFixturesByIds(env: Env, ids: string[]): Promise<Fixture[]> {
  if (!ids.length) return [];
  const url = `https://v3.football.api-sports.io/fixtures?ids=${encodeURIComponent(ids.slice(0, 20).join("-"))}`;
  const response = await fetch(url, {
    headers: { "x-apisports-key": env.API_FOOTBALL_KEY, Accept: "application/json" },
  });
  const payload = (await response.json()) as Record<string, any>;
  if (!response.ok) {
    throw new Error(`API-FOOTBALL ${response.status}: ${JSON.stringify(payload?.errors ?? payload)}`);
  }
  const errors = payload?.errors;
  const hasErrors = Array.isArray(errors) ? errors.length > 0 : errors && Object.keys(errors).length > 0;
  if (hasErrors) throw new Error(`API-FOOTBALL erreur: ${JSON.stringify(errors)}`);
  return (payload?.response as Fixture[]) ?? [];
}

// Coeur du cron. Quatre branches, dans cet ordre :
//   1. matin (1x/jour) : adopte matches:base (la passe Python a finalise scores + matchs a venir)
//   2. match live       : recupere les infos live et les applique sur l'etat accumule
//   3. rien en cours    : ne fait rien (aucun appel API, aucune ecriture)
async function syncLive(env: Env): Promise<void> {
  const now = Date.now();
  const nowDate = new Date(now);
  const today = nowDate.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const reseedHour = Number(env.RESEED_HOUR_UTC ?? DEFAULT_RESEED_HOUR);

  let data = await readJson(env, MATCHES_CURRENT);
  let mustWrite = false;
  if (!data) {
    data = await readJson(env, MATCHES_BASE); // amorcage depuis la base poussee par Python
    if (!data) return; // pas encore de donnees : rien a faire
    mustWrite = true;
  }

  // 1) Passe du matin : adopte le calendrier finalise par Python (matchs a venir + scores passes).
  if (data.workerMorningReseed !== today && nowDate.getUTCHours() >= reseedHour) {
    const base = await readJson(env, MATCHES_BASE);
    if (base) {
      // On preserve les experts generes par l'IA (sinon ils seraient ecrases par la base Python).
      const prevExperts = new Map<string, any>();
      for (const m of Array.isArray(data.matches) ? data.matches : []) {
        if (m.expertsAI && Array.isArray(m.expertDiscussion)) prevExperts.set(String(m.id), m.expertDiscussion);
      }
      for (const m of Array.isArray(base.matches) ? base.matches : []) {
        const ed = prevExperts.get(String(m.id));
        if (ed && m.status !== "finished") {
          m.expertDiscussion = ed;
          m.expertsAI = true;
        }
      }
      base.workerMorningReseed = today;
      await env.MATCHES.put(MATCHES_CURRENT, JSON.stringify(base));
      return;
    }
  }

  // 2) Match(s) en cours : on applique les infos live sur l'etat accumule.
  const matches: Match[] = Array.isArray(data.matches) ? data.matches : [];
  const candidates = findLiveCandidates(matches, now, BEFORE_MS, AFTER_MS);
  if (candidates.length > 0) {
    const fixtures = await fetchLiveFixtures(env);
    const updated = mergeLiveFixtures(fixtures, candidates);
    const checkedAt = nowDate.toISOString();
    data.liveSync = {
      provider: "api-football-cf",
      checkedAt,
      league: Number(env.WORLD_CUP_LEAGUE),
      season: Number(env.WORLD_CUP_SEASON),
      updatedMatches: updated,
      localLiveCandidates: candidates.map((m) => m.id),
    };
    if (updated > 0) data.lastUpdated = checkedAt;
    mustWrite = true;
  }

  // 3) Apres-match : toutes les 10 min pendant 1h, on rattrape le score final
  //    (un match termine ne ressort plus dans live=all -> requete ciblee par id).
  const postCandidates = findPostMatchCandidates(matches, now, POST_AFTER_MS, POST_UNTIL_MS);
  if (postCandidates.length > 0 && nowDate.getUTCMinutes() % POST_MATCH_EVERY_MIN === 0) {
    const ids = postCandidates.map(getApiFixtureId).filter(Boolean);
    if (ids.length > 0) {
      const fixtures = await fetchFixturesByIds(env, ids);
      const updated = mergeLiveFixtures(fixtures, postCandidates);
      if (updated > 0) {
        const checkedAt = nowDate.toISOString();
        data.lastUpdated = checkedAt;
        data.postMatchSync = { checkedAt, updatedMatches: updated };
        mustWrite = true;
      }
    }
  }

  // 4) Discussions d'experts : genere (via Workers AI) les avis manquants pour les
  //    prochains matchs, par petits lots, et persiste dans le KV.
  if (await maybeGenerateExperts(env, data, now, EXPERT_BATCH)) {
    mustWrite = true;
  }

  // 5) Sinon : rien a faire. On n'ecrit que si on a quelque chose a persister.
  if (mustWrite) {
    await env.MATCHES.put(MATCHES_CURRENT, JSON.stringify(data));
  }
}

// Sync a la demande (endpoint /sync) : repart de matches:base (statique pousse par Python),
// applique le live courant, ecrit matches:current. Utilise pour rafraichir la preprod.
async function onDemandSync(env: Env): Promise<Record<string, any>> {
  const base = await readJson(env, MATCHES_BASE);
  if (!base) return { ok: false, reason: "no base" };

  const matches: Match[] = Array.isArray(base.matches) ? base.matches : [];
  const now = Date.now();

  // Preserve les experts deja generes (presents dans matches:current).
  const prev = await readJson(env, MATCHES_CURRENT);
  if (prev) {
    const prevExperts = new Map<string, any>();
    for (const m of Array.isArray(prev.matches) ? prev.matches : []) {
      if (m.expertsAI && Array.isArray(m.expertDiscussion)) prevExperts.set(String(m.id), m.expertDiscussion);
    }
    for (const m of matches) {
      const ed = prevExperts.get(String(m.id));
      if (ed && m.status !== "finished") {
        m.expertDiscussion = ed;
        m.expertsAI = true;
      }
    }
  }

  const candidates = findLiveCandidates(matches, now, BEFORE_MS, AFTER_MS);
  let updated = 0;
  if (candidates.length > 0) {
    const fixtures = await fetchLiveFixtures(env);
    updated = mergeLiveFixtures(fixtures, candidates);
  }
  const generated = await maybeGenerateExperts(env, base, now, 8);
  const checkedAt = new Date(now).toISOString();
  base.lastUpdated = checkedAt;
  base.liveSync = { provider: "api-football-cf", checkedAt, updatedMatches: updated, expertsGenerated: generated, onDemand: true };
  await env.MATCHES.put(MATCHES_CURRENT, JSON.stringify(base));
  return { ok: true, updatedMatches: updated, expertsGenerated: generated, liveCandidates: candidates.length };
}

export default {
  // Declenche par le cron "* * * * *".
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(syncLive(env));
  },

  // Sert TOUTES les donnees au frontend depuis le KV, routees par chemin :
  //   /            ou /matches  -> matches (live merge, fallback base)
  //   /standings, /players, /odds          -> tels quels
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(pickOrigin(request, env));
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const path = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "");

    // Sync a la demande (protege par token) : declenche le merge live et ecrit le KV.
    if (path === "sync") {
      const url = new URL(request.url);
      const token = url.searchParams.get("token") || request.headers.get("x-sync-token") || "";
      if (!env.SYNC_TOKEN || token !== env.SYNC_TOKEN) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
        });
      }
      const result = await onDemandSync(env);
      return new Response(JSON.stringify(result), {
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    let key: string;
    if (path === "" || path === "matches") {
      key = MATCHES_CURRENT;
    } else if (PASSTHROUGH_KEYS.has(path)) {
      key = path;
    } else {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // A) Filtre d'origine : ne sert la donnee qu'aux origines autorisees (app .fr / preprod / dev).
    //    Bloque la recuperation directe (curl sans origine) de la donnee API-Football.
    if (!originAllowed(requestOriginOf(request), env)) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // B) Rate limiting par IP (actif si le binding RATE_LIMITER est configure).
    if (env.RATE_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") || "anon";
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) {
        return new Response(JSON.stringify({ error: "rate limited" }), {
          status: 429,
          headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
        });
      }
    }

    let body = await env.MATCHES.get(key);
    if (!body && key === MATCHES_CURRENT) {
      body = await env.MATCHES.get(MATCHES_BASE); // avant le 1er cron : on relaie la base
    }

    return new Response(body ?? "{}", {
      headers: {
        ...cors,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=15",
      },
    });
  },
};
