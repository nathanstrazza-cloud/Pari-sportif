import { findLiveCandidates, mergeLiveFixtures, type Match, type Fixture } from "./merge";

export interface Env {
  MATCHES: KVNamespace;
  API_FOOTBALL_KEY: string;
  WORLD_CUP_LEAGUE: string;
  WORLD_CUP_SEASON: string;
  SCHEDULE_URL: string;
  ALLOWED_ORIGIN?: string;
  RESEED_HOUR_UTC?: string;
}

const KV_KEY = "matches:current";
const BEFORE_MS = 15 * 60 * 1000; // 15 min avant le coup d'envoi
const AFTER_MS = 150 * 60 * 1000; // 150 min apres
const DEFAULT_RESEED_HOUR = 11; // UTC, apres la passe Python du matin (cron 10h UTC)

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Calendrier de base (maintenu par la passe Python du matin, servi par GitHub Pages).
async function loadSchedule(env: Env): Promise<Record<string, any>> {
  const response = await fetch(env.SCHEDULE_URL, { cf: { cacheTtl: 0 } } as RequestInit);
  if (!response.ok) throw new Error(`Calendrier introuvable (${response.status})`);
  return (await response.json()) as Record<string, any>;
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
//   1. matin (1x/jour) : re-seed depuis Pages (la passe Python a finalise scores + matchs a venir)
//   2. match live       : recupere les infos live et les applique sur l'etat accumule
//   3. rien en cours    : ne fait rien (aucun appel API, aucune ecriture)
async function syncLive(env: Env): Promise<void> {
  const now = Date.now();
  const nowDate = new Date(now);
  const today = nowDate.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const reseedHour = Number(env.RESEED_HOUR_UTC ?? DEFAULT_RESEED_HOUR);

  // Etat accumule : on part du KV (qui conserve les scores finaux), pas de Pages a chaque minute.
  let data = await readState(env);
  let mustWrite = false;
  if (!data) {
    data = await loadSchedule(env); // amorcage initial
    mustWrite = true;
  }

  // 1) Passe du matin : adopte le calendrier finalise par la passe Python (matchs a venir + scores passes).
  if (data.workerMorningReseed !== today && nowDate.getUTCHours() >= reseedHour) {
    const fresh = await loadSchedule(env);
    fresh.workerMorningReseed = today;
    await env.MATCHES.put(KV_KEY, JSON.stringify(fresh));
    return;
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
    await env.MATCHES.put(KV_KEY, JSON.stringify(data));
  }
}

async function readState(env: Env): Promise<Record<string, any> | null> {
  const body = await env.MATCHES.get(KV_KEY);
  if (!body) return null;
  try {
    return JSON.parse(body) as Record<string, any>;
  } catch {
    return null;
  }
}

export default {
  // Declenche par le cron "* * * * *".
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(syncLive(env));
  },

  // Sert les donnees au frontend (lit le KV, fallback sur le calendrier de base).
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN || "*";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    let body = await env.MATCHES.get(KV_KEY);
    if (!body) {
      // KV pas encore peuple (avant le 1er cron) : on relaie le calendrier de base.
      try {
        body = JSON.stringify(await loadSchedule(env));
      } catch {
        body = "{}";
      }
    }

    return new Response(body, {
      headers: {
        ...cors,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=15",
      },
    });
  },
};
