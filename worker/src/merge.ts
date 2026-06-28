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

// Id de fixture API-FOOTBALL d'un match local (pour les requetes ciblees apres-match).
export function getApiFixtureId(match: Match): string {
  const externalIds = match.externalIds && typeof match.externalIds === "object" ? match.externalIds : {};
  return cleanId(match.apiFootballFixtureId) || cleanId(externalIds.apiFootball) || "";
}

// Matchs en fenetre "apres-match" : pas encore termines, entre date+after et date+until.
// Sert a rattraper le score final (le flux live=all ne renvoie plus un match termine).
export function findPostMatchCandidates(matches: Match[], nowMs: number, afterMs: number, untilMs: number): Match[] {
  const candidates: Match[] = [];
  for (const match of matches) {
    if (match.status === "finished") continue;
    const matchDate = parseDate(match.date);
    if (matchDate === null) continue;
    if (matchDate + afterMs <= nowMs && nowMs <= matchDate + untilMs) {
      candidates.push(match);
    }
  }
  return candidates;
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

// Appaire chaque fixture API a son match local (pour enrichir buteurs/cartons/stats).
export function matchFixtures(fixtures: Fixture[], candidates: Match[]): Array<{ match: Match; fixture: Fixture }> {
  const pairs: Array<{ match: Match; fixture: Fixture }> = [];
  for (const fixture of fixtures) {
    const match = findLocalMatch(fixture, candidates);
    if (match) pairs.push({ match, fixture });
  }
  return pairs;
}

// ─────────────────────────── Noms d'equipes FR ───────────────────────────
// Porte depuis scripts/sync_live_scores.py (TEAM_NAME_FR). Sert a afficher les
// buteurs / cartons / classement / leaders en francais (l'API renvoie l'anglais).
const TEAM_NAME_FR: Record<string, string> = {
  Algeria: "Algérie",
  Argentina: "Argentine",
  Australia: "Australie",
  Austria: "Autriche",
  Belgium: "Belgique",
  Brazil: "Brésil",
  "Bosnia and Herzegovina": "Bosnie-et-Herzégovine",
  "Bosnia & Herzegovina": "Bosnie-et-Herzégovine",
  "Cape Verde": "Cap-Vert",
  "Cape Verde Islands": "Cap-Vert",
  Colombia: "Colombie",
  "Congo DR": "RD Congo",
  Croatia: "Croatie",
  Curaçao: "Curaçao",
  Czechia: "Tchéquie",
  "Czech Republic": "Tchéquie",
  Ecuador: "Équateur",
  Egypt: "Égypte",
  England: "Angleterre",
  Germany: "Allemagne",
  Ghana: "Ghana",
  Haiti: "Haïti",
  "IR Iran": "Iran",
  Iran: "Iran",
  Iraq: "Irak",
  "Ivory Coast": "Côte d’Ivoire",
  Japan: "Japon",
  Jordan: "Jordanie",
  Mexico: "Mexique",
  Morocco: "Maroc",
  Netherlands: "Pays-Bas",
  "New Zealand": "Nouvelle-Zélande",
  Norway: "Norvège",
  Panama: "Panama",
  Paraguay: "Paraguay",
  Portugal: "Portugal",
  Qatar: "Qatar",
  Scotland: "Écosse",
  Senegal: "Sénégal",
  "Saudi Arabia": "Arabie saoudite",
  "South Africa": "Afrique du Sud",
  "South Korea": "République de Corée",
  "Korea Republic": "République de Corée",
  Spain: "Espagne",
  Sweden: "Suède",
  Switzerland: "Suisse",
  Tunisia: "Tunisie",
  Türkiye: "Turquie",
  Turkey: "Turquie",
  "United States": "États-Unis",
  USA: "États-Unis",
  Uruguay: "Uruguay",
  Uzbekistan: "Ouzbékistan",
};

export function displayTeamName(name: unknown): string {
  const value = String(name ?? "").trim();
  return TEAM_NAME_FR[value] ?? value;
}

// ─────────────────────────── Buteurs & cartons (events) ───────────────────────────
const NBSP = " ";

function formatMinute(time: any): string {
  const elapsed = time?.elapsed;
  if (elapsed === null || elapsed === undefined) return "";
  const extra = time?.extra;
  return extra ? `${elapsed}'+${extra}'` : `${elapsed}'`;
}

// Construit match.scorers (chaines formatees comme la passe Python) et match.cards
// a partir du flux /fixtures/events. Le nom d'equipe entre parentheses est celui du
// JOUEUR (pour un csc, le front l'attribue automatiquement a l'adversaire).
export function applyEvents(match: Match, events: any[]): void {
  const scorers: string[] = [];
  const cards: Array<{ minute: string; player: string; team: string; type: "yellow" | "red" }> = [];
  for (const ev of Array.isArray(events) ? events : []) {
    const type = ev?.type;
    const detail = String(ev?.detail ?? "");
    const teamFr = displayTeamName(ev?.team?.name);
    const player = String(ev?.player?.name ?? "").trim();
    const min = formatMinute(ev?.time);
    if (type === "Goal") {
      if (/missed/i.test(detail)) continue; // penalty manque : pas un but
      if (/own\s*goal/i.test(detail)) {
        scorers.push(`${min} ${player} (${teamFr}) marque contre son camp.`);
      } else if (/penalty/i.test(detail)) {
        scorers.push(`${min} ${player} (${teamFr}) transforme le penalty${NBSP}!`);
      } else {
        scorers.push(`${min} But de ${player} (${teamFr})${NBSP}!`);
      }
    } else if (type === "Card") {
      const cardType = /red/i.test(detail) ? "red" : /yellow/i.test(detail) ? "yellow" : null;
      if (cardType) cards.push({ minute: min, player, team: teamFr, type: cardType });
    }
  }
  match.scorers = scorers;
  match.cards = cards;
}

// ─────────────────────────── Stats de match (statistics) ───────────────────────────
const STAT_TYPE_MAP: Record<string, string> = {
  "Ball Possession": "possession",
  "Total Shots": "shots",
  "Shots on Goal": "shotsOnTarget",
  "Corner Kicks": "corners",
  Fouls: "fouls",
};

function parseStatValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = parseFloat(String(value).replace("%", ""));
  return Number.isNaN(num) ? null : num;
}

// Remplit match.stats depuis /fixtures/statistics. homeId/awayId viennent de la fixture
// pour assigner chaque bloc de stats au bon cote.
export function applyStatistics(match: Match, statsResponse: any[], homeId: unknown, awayId: unknown): void {
  if (!match.stats || typeof match.stats !== "object") match.stats = {};
  const stats = match.stats as Record<string, any>;
  for (const key of Object.values(STAT_TYPE_MAP)) {
    if (!stats[key] || typeof stats[key] !== "object") stats[key] = { home: null, away: null };
  }
  for (const entry of Array.isArray(statsResponse) ? statsResponse : []) {
    const id = entry?.team?.id;
    const side = id === homeId ? "home" : id === awayId ? "away" : null;
    if (!side) continue;
    for (const s of Array.isArray(entry?.statistics) ? entry.statistics : []) {
      const key = STAT_TYPE_MAP[s?.type];
      if (!key) continue;
      stats[key][side] = parseStatValue(s?.value);
    }
  }
}

// ─────────────────────────── Classement & leaders ───────────────────────────
function formatGroupName(name: unknown): string {
  if (!name) return "Groupe";
  return String(name).replace("Group ", "Groupe ");
}

function isWorldCupGroupName(name: string): boolean {
  const valid = new Set("ABCDEFGHIJKL".split("").map((l) => `Groupe ${l}`));
  return valid.has(String(name ?? "").trim());
}

function formatStandingTeam(row: any): Record<string, any> {
  const all = row?.all ?? {};
  const description = row?.description ?? "";
  const rank = row?.rank;
  const played = all?.played;
  let status = "";
  if (description) status = rank === 3 ? "best-third" : "qualified";
  else if (played && played >= 3) status = "eliminated";
  return {
    rank,
    name: displayTeamName(row?.team?.name),
    played,
    points: row?.points,
    gd: row?.goalsDiff,
    status,
  };
}

// Construit le JSON standings (meme forme que scripts/sync_competition_data.py).
export function buildStandings(response: any[], checkedAt: string): Record<string, any> {
  const leagueRows = response?.[0]?.league?.standings ?? [];
  const groups: Array<Record<string, any>> = [];
  for (const groupRows of leagueRows) {
    if (!Array.isArray(groupRows) || !groupRows.length) continue;
    const name = formatGroupName(groupRows[0]?.group);
    if (!isWorldCupGroupName(name)) continue;
    groups.push({ name, teams: groupRows.map(formatStandingTeam) });
  }
  return { lastUpdated: checkedAt, source: "api-football-cf", groups };
}

function formatPlayer(row: any, valueKey: string, sourceKey: string[]): Record<string, any> {
  const player = row?.player ?? {};
  const stats = (Array.isArray(row?.statistics) ? row.statistics[0] : null) ?? {};
  let value: any = stats;
  for (const key of sourceKey) value = value?.[key];
  const num = value === null || value === undefined ? null : parseFloat(String(value));
  return {
    name: player?.name,
    team: displayTeamName(stats?.team?.name),
    age: player?.age,
    [valueKey]: Number.isNaN(num as number) ? null : num,
  };
}

// Construit le JSON players (topScorers + topAssists) comme la passe Python.
export function buildPlayers(scorers: any[], assists: any[], checkedAt: string): Record<string, any> {
  const topScorers = (Array.isArray(scorers) ? scorers : [])
    .map((row) => formatPlayer(row, "goals", ["goals", "total"]))
    .filter((p) => p.goals);
  const topAssists = (Array.isArray(assists) ? assists : [])
    .map((row) => formatPlayer(row, "assists", ["goals", "assists"]))
    .filter((p) => p.assists);
  return {
    lastUpdated: checkedAt,
    source: "api-football-cf",
    topScorers,
    topAssists,
    topPlayers: [],
    youngPlayers: [],
  };
}
