// Logique de fusion des scores live, portee depuis scripts/sync_live_scores.py.
// Ne touche QUE le chemin live : statut, minute, score, externalIds.
// (Le calendrier reste gere par la passe Python du matin.)

const LIVE_STATUSES = new Set(["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"]);
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
const UPCOMING_STATUSES = new Set(["NS", "TBD", "PST"]);

// Alias d'equipes : nom FR normalise -> variantes EN possibles cote API.
const TEAM_ALIASES: Record<string, string[]> = {
  "afrique du sud": ["south africa"],
  "bosnie et herzegovine": ["bosnia and herzegovina", "bosnia"],
  "etats unis": ["usa", "united states", "united states of america"],
  mexique: ["mexico"],
  "republique de coree": ["south korea", "korea republic", "korea"],
  suisse: ["switzerland"],
  tchequie: ["czech republic", "czechia"],
};

export type Match = Record<string, any>;
export type Fixture = Record<string, any>;

export function normalize(value: unknown): string {
  let text = String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, ""); // retire les diacritiques
  text = text.toLowerCase().replace(/&/g, " and ");
  text = text.replace(/[-_.,'’()]/g, " ");
  return text.split(/\s+/).filter(Boolean).join(" ");
}

function teamOptions(name: unknown): Set<string> {
  const normalized = normalize(name);
  const options = new Set<string>([normalized]);
  for (const alias of TEAM_ALIASES[normalized] ?? []) {
    options.add(alias);
  }
  return new Set([...options].map(normalize).filter(Boolean));
}

function teamMatches(localName: unknown, apiName: unknown): boolean {
  const local = teamOptions(localName);
  const api = teamOptions(apiName);
  for (const option of local) {
    if (api.has(option)) return true;
  }
  return false;
}

function sameTeamPair(localHome: unknown, localAway: unknown, fixtureHome: unknown, fixtureAway: unknown): boolean {
  return teamMatches(localHome, fixtureHome) && teamMatches(localAway, fixtureAway);
}

// Renvoie un timestamp ms en UTC, ou null si invalide.
export function parseDate(value: unknown): number | null {
  if (!value) return null;
  const ts = Date.parse(String(value));
  return Number.isNaN(ts) ? null : ts;
}

function sameMatchDay(localDate: unknown, fixtureDate: number | null): boolean {
  const local = parseDate(localDate);
  if (local === null || fixtureDate === null) return true;
  return Math.abs(local - fixtureDate) <= 12 * 60 * 60 * 1000;
}

function mapStatus(shortStatus: string | undefined): string {
  if (shortStatus && LIVE_STATUSES.has(shortStatus)) return "live";
  if (shortStatus && FINISHED_STATUSES.has(shortStatus)) return "finished";
  if (shortStatus && UPCOMING_STATUSES.has(shortStatus)) return "upcoming";
  return "live";
}

function cleanId(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

// Matchs locaux susceptibles d'etre en cours, dans une fenetre [date-before, date+after].
export function findLiveCandidates(matches: Match[], nowMs: number, beforeMs: number, afterMs: number): Match[] {
  const candidates: Match[] = [];
  for (const match of matches) {
    const status = match.status;
    if (status === "finished") continue;
    if (status === "live") {
      candidates.push(match);
      continue;
    }
    const matchDate = parseDate(match.date);
    if (matchDate === null) continue;
    if (matchDate - beforeMs <= nowMs && nowMs <= matchDate + afterMs) {
      candidates.push(match);
    }
  }
  return candidates;
}

function findLocalMatch(fixture: Fixture, candidates: Match[]): Match | null {
  const fixtureId = cleanId(fixture?.fixture?.id);
  for (const match of candidates) {
    const externalIds = match.externalIds && typeof match.externalIds === "object" ? match.externalIds : {};
    const knownIds = new Set([
      cleanId(match.id),
      cleanId(match.apiFootballFixtureId),
      cleanId(externalIds.apiFootball),
    ]);
    knownIds.delete("");
    if (fixtureId && knownIds.has(fixtureId)) return match;
  }

  const fixtureHome = fixture?.teams?.home?.name;
  const fixtureAway = fixture?.teams?.away?.name;
  const fixtureDate = parseDate(fixture?.fixture?.date);

  for (const match of candidates) {
    if (!sameMatchDay(match.date, fixtureDate)) continue;
    if (sameTeamPair(match.home, match.away, fixtureHome, fixtureAway)) return match;
  }

  return null;
}

function applyFixture(match: Match, fixture: Fixture): void {
  const fixtureStatus = fixture?.fixture?.status ?? {};
  const shortStatus = fixtureStatus.short;
  const elapsed = fixtureStatus.elapsed;
  const goals = fixture?.goals ?? {};

  match.status = mapStatus(shortStatus);
  match.minute = match.status === "live" ? elapsed ?? null : null;
  if (!match.score || typeof match.score !== "object") match.score = {};
  match.score.home = goals.home ?? null;
  match.score.away = goals.away ?? null;

  const fixtureId = fixture?.fixture?.id;
  if (fixtureId) {
    if (!match.externalIds || typeof match.externalIds !== "object") match.externalIds = {};
    match.externalIds.apiFootball = String(fixtureId);
  }
}

// Fusionne les fixtures live de l'API dans les matchs candidats. Renvoie le nombre mis a jour.
export function mergeLiveFixtures(fixtures: Fixture[], candidates: Match[]): number {
  let updated = 0;
  for (const fixture of fixtures) {
    const match = findLocalMatch(fixture, candidates);
    if (!match) continue;
    applyFixture(match, fixture);
    updated += 1;
  }
  return updated;
}
