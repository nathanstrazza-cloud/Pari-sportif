import { findLiveCandidates, mergeLiveFixtures, type Match, type Fixture } from "./merge";

export interface Env {
  MATCHES: KVNamespace;
  API_FOOTBALL_KEY: string;
  WORLD_CUP_LEAGUE: string;
  WORLD_CUP_SEASON: string;
  ALLOWED_ORIGINS?: string;
  RESEED_HOUR_UTC?: string;
}

// Cles KV (par environnement) :
//   matches:base    <- pousse par la passe Python (calendrier + scores finalises)
//   matches:current <- etat accumule par le Worker (live merge), c'est ce qui est servi
//   standings / players / odds <- pousses par Python, servis tels quels
const MATCHES_CURRENT = "matches:current";
const MATCHES_BASE = "matches:base";
const PASSTHROUGH_KEYS = new Set(["standings", "players", "odds"]);

const BEFORE_MS = 15 * 60 * 1000; // 15 min avant le coup d'envoi
const AFTER_MS = 150 * 60 * 1000; // 150 min apres
const DEFAULT_RESEED_HOUR = 11; // UTC, apres la passe Python du matin (cron 10h UTC)

// Choisit l'origine a renvoyer : si l'origine de la requete est dans l'allowlist, on la renvoie.
// Permet de servir plusieurs environnements (preprod + prod).
function pickOrigin(request: Request, env: Env): string {
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const requestOrigin = request.headers.get("Origin");
  if (requestOrigin && allowed.includes(requestOrigin)) return requestOrigin;
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

// Coeur du cron. Trois branches, dans cet ordre :
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

  // 3) Sinon : rien a faire. On n'ecrit que si on vient d'amorcer le KV.
  if (mustWrite) {
    await env.MATCHES.put(MATCHES_CURRENT, JSON.stringify(data));
  }
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
