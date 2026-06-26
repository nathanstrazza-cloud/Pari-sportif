// Workers Cloudflare qui servent TOUTES les donnees (matches live, classements, cotes, joueurs).
// L'environnement est choisi selon le domaine : la prod (.fr) tape le Worker prod, sinon preprod.
const DATA_WORKERS = {
  prod: "https://coteadede-prod.bstrazza.workers.dev",
  preprod: "https://coteadede-preprod.bstrazza.workers.dev",
};
const PROD_HOSTS = ["lacoteadede.fr", "www.lacoteadede.fr"];
// Prod = le domaine .fr ou le projet Pages prod (y compris ses URLs de preview *.coteadede-prod.pages.dev).
const IS_PROD =
  PROD_HOSTS.includes(location.hostname) || location.hostname.endsWith("coteadede-prod.pages.dev");
const DATA_BASE = IS_PROD ? DATA_WORKERS.prod : DATA_WORKERS.preprod;

// Fichiers locaux de repli si le Worker est injoignable.
const LOCAL_DATA_FILES = {
  matches: "data/matches.json",
  standings: "data/standings.json",
  players: "data/players-ea.json",
  cards: "data/Cartes.json",
  odds: "data/odds.json",
};

const state = {
  matches: [],
  standings: [],
  players: {},
  playerCards: {},
  odds: {},
  betSuggestions: {},
  matchOdds: {},
  knockout: {},
  selectedMatchId: null,
  selectedTeam: null,
  detailTeam: null,
  activeTab: "matches",
  activeStandingView: "groups",
  activeStage: "round32",
  refreshTimer: null,
  touchStartX: 0,
  lastRefresh: null,
  activeDetailTab: null,
  detailMatch: null,
};

const stageOrder = ["round32", "round16", "quarterfinals", "semifinals", "final"];
const stageLabels = {
  round32: "16es",
  round16: "8es",
  quarterfinals: "Quarts",
  semifinals: "Demies",
  final: "Finale",
};

const knockoutStageByMatchStage = {
  "16es": "round32",
  "round of 32": "round32",
  "8es": "round16",
  "round of 16": "round16",
  quarts: "quarterfinals",
  "quarter finals": "quarterfinals",
  "quarter-finals": "quarterfinals",
  demies: "semifinals",
  "semi finals": "semifinals",
  "semi-finals": "semifinals",
  finale: "final",
  final: "final",
};

const round32Fixtures = [
  { match: 73, home: rankSeed("A", 2), away: rankSeed("B", 2) },
  { match: 74, home: rankSeed("E", 1), away: thirdSeed(["A", "B", "C", "D", "F"]) },
  { match: 75, home: rankSeed("F", 1), away: rankSeed("C", 2) },
  { match: 76, home: rankSeed("C", 1), away: rankSeed("F", 2) },
  { match: 77, home: rankSeed("I", 1), away: thirdSeed(["C", "D", "F", "G", "H"]) },
  { match: 78, home: rankSeed("E", 2), away: rankSeed("I", 2) },
  { match: 79, home: rankSeed("A", 1), away: thirdSeed(["C", "E", "F", "H", "I"]) },
  { match: 80, home: rankSeed("L", 1), away: thirdSeed(["E", "H", "I", "J", "K"]) },
  { match: 81, home: rankSeed("D", 1), away: thirdSeed(["B", "E", "F", "I", "J"]) },
  { match: 82, home: rankSeed("G", 1), away: thirdSeed(["A", "E", "H", "I", "J"]) },
  { match: 83, home: rankSeed("K", 2), away: rankSeed("L", 2) },
  { match: 84, home: rankSeed("H", 1), away: rankSeed("J", 2) },
  { match: 85, home: rankSeed("B", 1), away: thirdSeed(["E", "F", "G", "I", "J"]) },
  { match: 86, home: rankSeed("J", 1), away: rankSeed("H", 2) },
  { match: 87, home: rankSeed("K", 1), away: thirdSeed(["D", "E", "I", "J", "L"]) },
  { match: 88, home: rankSeed("D", 2), away: rankSeed("G", 2) },
];

const round16Fixtures = [
  { match: 89, homeMatch: 73, awayMatch: 75 },
  { match: 90, homeMatch: 74, awayMatch: 77 },
  { match: 91, homeMatch: 76, awayMatch: 78 },
  { match: 92, homeMatch: 79, awayMatch: 80 },
  { match: 93, homeMatch: 83, awayMatch: 84 },
  { match: 94, homeMatch: 81, awayMatch: 82 },
  { match: 95, homeMatch: 86, awayMatch: 88 },
  { match: 96, homeMatch: 85, awayMatch: 87 },
];

const quarterfinalFixtures = [
  { match: 97, homeMatch: 89, awayMatch: 90 },
  { match: 98, homeMatch: 93, awayMatch: 94 },
  { match: 99, homeMatch: 91, awayMatch: 92 },
  { match: 100, homeMatch: 95, awayMatch: 96 },
];

const semifinalFixtures = [
  { match: 101, homeMatch: 97, awayMatch: 98 },
  { match: 102, homeMatch: 99, awayMatch: 100 },
];

const finalFixture = { match: 104, homeMatch: 101, awayMatch: 102 };

const stagePathOrders = {
  round32: [73, 75, 74, 77, 83, 84, 81, 82, 76, 78, 79, 80, 86, 88, 85, 87],
  round16: [89, 90, 93, 94, 91, 92, 95, 96],
  quarterfinals: [97, 98, 99, 100],
  semifinals: [101, 102],
  final: [104],
};

const stageSlotRows = {
  round32: (index) => 1 + (index * 2),
  round16: (index) => 2 + (index * 4),
  quarterfinals: (index) => 4 + (index * 8),
  semifinals: (index) => 8 + (index * 16),
  final: () => 16,
};

const bracketLayout = {
  cardHeight: 104,
  slotHeight: 58,
  stageGap: 56,
  sidePeek: 72,
  maxViewportWidth: 768,
  minStageWidth: 248,
};

const compactStageRows = {
  quarterfinals: (index) => 1 + (index * 2),
  semifinals: (index) => 2 + (index * 4),
  final: () => 4,
};

const statusLabels = {
  live: "Live",
  finished: "Terminé",
  upcoming: "À venir",
};

const m6PlusUrl = "https://www.m6.fr";
const m6YoutubeSearchUrl = "https://www.youtube.com/results?search_query=M6+football+r%C3%A9sum%C3%A9";

const groupStatusLabels = {
  qualified: "Qualifié",
  "best-third": "Meilleur 3e",
  eliminated: "Éliminé",
};

const bestThirdQualifyingCount = 8;

const forcedCardStartersByTeam = {
  france: ["kylian mbappe"],
};

const teamNameFr = {
  Algeria: "Algérie",
  Argentina: "Argentine",
  Australia: "Australie",
  Austria: "Autriche",
  Belgium: "Belgique",
  Brazil: "Brésil",
  "Bosnia and Herzegovina": "Bosnie-et-Herzégovine",
  "Bosnia & Herzegovina": "Bosnie-et-Herzégovine",
  "Bosnie-Herzégovine": "Bosnie-et-Herzégovine",
  "Cape Verde": "Cap-Vert",
  "Cape Verde Islands": "Cap-Vert",
  Canada: "Canada",
  Colombia: "Colombie",
  "Congo DR": "RD Congo",
  Croatia: "Croatie",
  Curaçao: "Curaçao",
  Ecuador: "Équateur",
  Egypt: "Égypte",
  England: "Angleterre",
  France: "France",
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
  "Corée du Sud": "République de Corée",
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

const teamFlags = {
  "afrique du sud": "za",
  algerie: "dz",
  allemagne: "de",
  angleterre: "gb-eng",
  "arabie saoudite": "sa",
  argentine: "ar",
  australie: "au",
  autriche: "at",
  belgique: "be",
  "bosnie et herzegovine": "ba",
  bresil: "br",
  canada: "ca",
  "cap vert": "cv",
  chili: "cl",
  colombie: "co",
  croatie: "hr",
  curacao: "cw",
  "cote d ivoire": "ci",
  "egypte": "eg",
  equateur: "ec",
  ecosse: "gb-sct",
  espagne: "es",
  "etats unis": "us",
  france: "fr",
  ghana: "gh",
  haiti: "ht",
  iran: "ir",
  irak: "iq",
  japon: "jp",
  jordanie: "jo",
  maroc: "ma",
  mexique: "mx",
  norvege: "no",
  "nouvelle zelande": "nz",
  ouzbekistan: "uz",
  panama: "pa",
  paraguay: "py",
  "pays bas": "nl",
  portugal: "pt",
  qatar: "qa",
  "rd congo": "cd",
  "republique de coree": "kr",
  senegal: "sn",
  suede: "se",
  suisse: "ch",
  tchequie: "cz",
  tunisie: "tn",
  turquie: "tr",
  uruguay: "uy",
};

const els = {};

document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  cacheElements();
  bindNavigation();
  bindBracket();
  bindMatchModal();
  bindTeamModal();
  bindInstallPrompt();

  try {
    await loadData();
    selectDefaultMatch();
    renderAll();
    scheduleRefresh();
    await registerServiceWorker();
  } catch (error) {
    renderError(error);
  } finally {
    window.setTimeout(() => {
      els.app?.setAttribute("aria-busy", "false");
      els.loadingScreen?.classList.add("is-hidden");
    }, 700);
  }
}

function cacheElements() {
  els.app = document.querySelector("#app");
  els.loadingScreen = document.querySelector("#loadingScreen");
  els.matchDetail = document.querySelector("#matchDetail");
  els.matchesList = document.querySelector("#matchesList");
  els.matchesCount = document.querySelector("#matchesCount");
  els.matchModal = document.querySelector("#matchModal");
  els.matchModalTitle = document.querySelector("#matchModalTitle");
  els.matchModalTabs = document.querySelector("#matchModalTabs");
  els.matchModalBody = document.querySelector("#matchModalBody");
  els.matchModalClose = document.querySelector("#matchModalClose");
  els.teamModal = document.querySelector("#teamModal");
  els.teamModalTitle = document.querySelector("#teamModalTitle");
  els.teamModalBody = document.querySelector("#teamModalBody");
  els.teamModalClose = document.querySelector("#teamModalClose");
  els.standingsSubtabs = document.querySelector("#standingsSubtabs");
  els.groupsGrid = document.querySelector("#groupsGrid");
  els.standingsLegend = document.querySelector("#standingsLegend");
  els.bestThirdBoard = document.querySelector("#bestThirdBoard");
  els.topScorersBoard = document.querySelector("#topScorersBoard");
  els.topAssistsBoard = document.querySelector("#topAssistsBoard");
  els.stageTabs = document.querySelector("#stageTabs");
  els.bracketStage = document.querySelector("#bracketStage");
  els.refreshPill = document.querySelector("#refreshPill");
  els.installButton = document.querySelector("#installButton");
  els.prevStage = document.querySelector("#prevStage");
  els.nextStage = document.querySelector("#nextStage");
}

async function loadData() {
  const [matches, standings, players, cards, odds] = await Promise.all([
    fetchData("matches"),
    fetchData("standings"),
    fetchData("players"),
    fetchData("cards"),
    fetchData("odds"),
  ]);

  state.matches = Array.isArray(matches.matches) ? matches.matches : [];
  state.standings = Array.isArray(standings.groups) ? standings.groups : [];
  state.knockout = buildKnockout(matches.knockout, state.matches, state.standings);
  state.players = players && typeof players === "object" ? players : {};
  state.playerCards = cards && typeof cards === "object" ? cards : {};
  state.odds = odds.markets && typeof odds.markets === "object" ? odds.markets : {};
  state.betSuggestions = odds.betSuggestions && typeof odds.betSuggestions === "object" ? odds.betSuggestions : {};
  state.matchOdds = odds.matchOdds && typeof odds.matchOdds === "object" ? odds.matchOdds : {};
  state.lastRefresh = new Date();
}

function buildKnockout(rawKnockout, matches, standings) {
  const source = rawKnockout && typeof rawKnockout === "object" ? rawKnockout : {};
  const knockout = Object.fromEntries(
    stageOrder.map((stage) => [stage, Array.isArray(source[stage]) ? [...source[stage]] : []])
  );

  matches
    .filter((match) => getKnockoutStageKey(match.stage))
    .forEach((match) => {
      const stage = getKnockoutStageKey(match.stage);
      const bracketMatch = mapMatchToBracketMatch(match, standings);
      const alreadyListed = knockout[stage].some((item) => isSameBracketMatch(item, bracketMatch));
      if (!alreadyListed) {
        knockout[stage].push(bracketMatch);
      }
    });

  knockout.round32 = mergeProjectedMatches(
    knockout.round32,
    buildProjectedRound32(standings, knockout.round32),
  );
  knockout.round16 = mergeProjectedMatches(
    knockout.round16,
    buildProjectedRound16(knockout.round32),
  );
  knockout.quarterfinals = mergeProjectedMatches(
    knockout.quarterfinals,
    buildProjectedStage(quarterfinalFixtures, "quarterfinals", "round16", knockout.round16),
  );
  knockout.semifinals = mergeProjectedMatches(
    knockout.semifinals,
    buildProjectedStage(semifinalFixtures, "semifinals", "quarterfinals", knockout.quarterfinals),
  );
  knockout.final = mergeProjectedMatches(
    knockout.final,
    buildProjectedStage([finalFixture], "final", "semifinals", knockout.semifinals),
  );

  Object.values(knockout).forEach((stageMatches) => {
    stageMatches.sort(compareBracketMatches);
  });

  return knockout;
}

function rankSeed(group, rank) {
  return { type: "rank", group, rank };
}

function thirdSeed(groups) {
  return { type: "third", groups };
}

function buildProjectedRound32(standings, existingRound32Matches = []) {
  const thirdAssignments = assignThirdPlaceSlots(standings, existingRound32Matches);

  return round32Fixtures.map((fixture) => {
    const home = resolveRound32Seed(fixture.home, standings, thirdAssignments, fixture.match);
    const away = resolveRound32Seed(fixture.away, standings, thirdAssignments, fixture.match);
    return {
      id: `projected-round32-${fixture.match}`,
      matchNumber: fixture.match,
      stage: stageLabels.round32,
      slot: formatStageSlot("round32", getStageOrderIndex("round32", fixture.match)),
      home,
      away,
      homeScore: null,
      awayScore: null,
      projected: true,
      sortOrder: getStageSortOrder("round32", fixture.match),
    };
  });
}

function buildProjectedRound16(round32Matches) {
  return round16Fixtures.map((fixture) => {
    const homeSource = findBracketMatchByNumber(round32Matches, fixture.homeMatch);
    const awaySource = findBracketMatchByNumber(round32Matches, fixture.awayMatch);
    return {
      id: `projected-round16-${fixture.match}`,
      matchNumber: fixture.match,
      stage: stageLabels.round16,
      slot: formatStageSlot("round16", getStageOrderIndex("round16", fixture.match)),
      home: formatWinnerSeed("round32", fixture.homeMatch),
      away: formatWinnerSeed("round32", fixture.awayMatch),
      homeOptions: getBracketMatchTeams(homeSource),
      awayOptions: getBracketMatchTeams(awaySource),
      homeScore: null,
      awayScore: null,
      projected: true,
      sortOrder: getStageSortOrder("round16", fixture.match),
    };
  });
}

function buildProjectedStage(fixtures, stage, sourceStage, sourceMatches) {
  return fixtures.map((fixture) => {
    const homeSource = findBracketMatchByNumber(sourceMatches, fixture.homeMatch);
    const awaySource = findBracketMatchByNumber(sourceMatches, fixture.awayMatch);
    return {
      id: `projected-${stage}-${fixture.match}`,
      matchNumber: fixture.match,
      stage: stageLabels[stage],
      slot: formatStageSlot(stage, getStageOrderIndex(stage, fixture.match)),
      home: formatWinnerSeed(sourceStage, fixture.homeMatch),
      away: formatWinnerSeed(sourceStage, fixture.awayMatch),
      homeOptions: [],
      awayOptions: [],
      sourceTeams: [
        ...getBracketMatchTeams(homeSource),
        ...getBracketMatchTeams(awaySource),
      ],
      homeScore: null,
      awayScore: null,
      projected: true,
      sortOrder: getStageSortOrder(stage, fixture.match),
    };
  });
}

function mergeProjectedMatches(matches, projections) {
  const merged = [...matches];

  projections.forEach((projection) => {
    const existing = merged.find((match) => isSameBracketProjection(match, projection));
    if (existing) {
      existing.matchNumber = existing.matchNumber ?? projection.matchNumber;
      existing.sortOrder = existing.sortOrder ?? projection.sortOrder;
      if (!hasSpecificSlot(existing.slot)) {
        existing.slot = projection.slot;
      }
      return;
    }

    merged.push(projection);
  });

  return merged;
}

function resolveRound32Seed(seed, standings, thirdAssignments, matchNumber) {
  if (seed.type === "third") {
    const row = thirdAssignments[matchNumber];
    return row?.team?.name ?? formatSeedLabel(seed);
  }

  return getGroupTeamByRank(standings, seed.group, seed.rank)?.name ?? formatSeedLabel(seed);
}

function assignThirdPlaceSlots(standings, existingRound32Matches = []) {
  const thirdRows = getThirdPlacedRows(standings).slice(0, bestThirdQualifyingCount);
  const slots = round32Fixtures
    .filter((fixture) => fixture.away.type === "third" || fixture.home.type === "third")
    .map((fixture) => ({
      match: fixture.match,
      groups: (fixture.away.type === "third" ? fixture.away.groups : fixture.home.groups),
    }));
  const lockedAssignment = getKnownThirdPlaceAssignments(slots, thirdRows, existingRound32Matches);
  const assignment = findThirdPlaceAssignment(slots, thirdRows, lockedAssignment);

  return Object.fromEntries(
    Object.entries(assignment).map(([match, groupLetter]) => [
      match,
      thirdRows.find((row) => row.groupLetter === groupLetter),
    ])
  );
}

function getKnownThirdPlaceAssignments(slots, thirdRows, existingRound32Matches) {
  return Object.fromEntries(
    existingRound32Matches
      .filter((match) => !match.projected)
      .map((match) => {
        const matchNumber = getBracketMatchNumber(match);
        const slot = slots.find((item) => item.match === matchNumber);
        if (!slot) return null;
        const row = thirdRows.find((candidate) =>
          slot.groups.includes(candidate.groupLetter)
            && (sameTeam(candidate.team.name, match.home) || sameTeam(candidate.team.name, match.away))
        );
        return row ? [String(slot.match), row.groupLetter] : null;
      })
      .filter(Boolean)
  );
}

function findThirdPlaceAssignment(slots, thirdRows, initialAssignment = {}) {
  const rowsByGroup = Object.fromEntries(thirdRows.map((row) => [row.groupLetter, row]));
  const initialUsedGroups = new Set(Object.values(initialAssignment));
  const slotOptions = slots.map((slot) => ({
    ...slot,
    options: slot.groups.filter((group) => rowsByGroup[group]),
  }));

  function search(assigned, usedGroups) {
    if (Object.keys(assigned).length === slotOptions.length) return assigned;

    const nextSlot = slotOptions
      .filter((slot) => !assigned[slot.match])
      .sort((left, right) => {
        const leftRemaining = left.options.filter((group) => !usedGroups.has(group)).length;
        const rightRemaining = right.options.filter((group) => !usedGroups.has(group)).length;
        return leftRemaining - rightRemaining || left.match - right.match;
      })[0];

    for (const group of nextSlot.options) {
      if (usedGroups.has(group)) continue;
      const result = search(
        { ...assigned, [nextSlot.match]: group },
        new Set([...usedGroups, group])
      );
      if (result) return result;
    }

    return null;
  }

  return search({ ...initialAssignment }, initialUsedGroups) ?? initialAssignment;
}

function getThirdPlacedRows(standings) {
  return standings
    .map((group) => {
      const groupLetter = getGroupLetter(group.name);
      const team = (group.teams ?? []).find((row) => Number(row.rank) === 3);
      return groupLetter && team ? { group, groupLetter, team } : null;
    })
    .filter(Boolean)
    .sort(compareThirdPlacedTeamRows);
}

function compareThirdPlacedTeamRows(left, right) {
  const points = Number(right.team.points ?? -Infinity) - Number(left.team.points ?? -Infinity);
  if (points) return points;

  const goalDifference = Number(right.team.gd ?? -Infinity) - Number(left.team.gd ?? -Infinity);
  if (goalDifference) return goalDifference;

  const played = Number(left.team.played ?? Infinity) - Number(right.team.played ?? Infinity);
  if (played) return played;

  return left.groupLetter.localeCompare(right.groupLetter, "fr-FR", { numeric: true });
}

function getGroupTeamByRank(standings, groupLetter, rank) {
  return getGroupByLetter(standings, groupLetter)?.teams?.find((team) => Number(team.rank) === rank) ?? null;
}

function getGroupByLetter(standings, groupLetter) {
  return standings.find((group) => getGroupLetter(group.name) === groupLetter) ?? null;
}

function getGroupLetter(groupName) {
  const match = String(groupName ?? "").match(/\b([A-L])\b/u);
  return match?.[1] ?? null;
}

function formatSeedLabel(seed) {
  if (seed.type === "third") return `3e ${seed.groups.join("/")}`;
  return `${seed.rank === 1 ? "1er" : `${seed.rank}e`} Groupe ${seed.group}`;
}

function findBracketMatchByNumber(matches, matchNumber) {
  return matches.find((match) => getBracketMatchNumber(match) === Number(matchNumber)) ?? null;
}

function getStageOrderIndex(stage, matchNumber) {
  const index = (stagePathOrders[stage] ?? []).indexOf(Number(matchNumber));
  return index >= 0 ? index : 0;
}

function getStageSortOrder(stage, matchNumber) {
  const index = getStageOrderIndex(stage, matchNumber);
  return index + 1;
}

function formatStageSlot(stage, index) {
  const number = formatOrdinal(index + 1, stage === "semifinals");

  if (stage === "round32") return `${number} 16e de finale`;
  if (stage === "round16") return `${number} 8e de finale`;
  if (stage === "quarterfinals") return `${number} quart de finale`;
  if (stage === "semifinals") return `${number} demie`;
  return "Finale";
}

function formatWinnerSeed(stage, matchNumber) {
  const slot = formatStageSlot(stage, getStageOrderIndex(stage, matchNumber));
  return stage === "semifinals" ? `Vainqueur de la ${slot}` : `Vainqueur du ${slot}`;
}

function formatOrdinal(value, feminine = false) {
  if (value === 1) return feminine ? "1re" : "1er";
  return `${value}e`;
}

function getBracketMatchNumber(match) {
  const value = match?.matchNumber ?? String(match?.slot ?? "").match(/\d+/u)?.[0] ?? null;
  return value ? Number(value) : null;
}

function getBracketMatchTeams(match) {
  return [match?.home, match?.away].filter((team) => team && !String(team).startsWith("Vainqueur"));
}

function isSameBracketProjection(match, projection) {
  const matchNumber = getBracketMatchNumber(match);
  if (matchNumber && matchNumber === projection.matchNumber) return true;
  return sameProjectedTeams(match, projection);
}

function sameProjectedTeams(match, projection) {
  return Boolean(
    match?.home
      && match?.away
      && sameTeam(match.home, projection.home)
      && sameTeam(match.away, projection.away)
  );
}

function hasSpecificSlot(slot) {
  return /^(match|m)\s*\d+/iu.test(String(slot ?? "").trim())
    || /(16e|8e|quart|demie|finale)/iu.test(String(slot ?? "").trim());
}

function compareBracketMatches(left, right) {
  const sortOrder = Number(left.sortOrder ?? getBracketMatchNumber(left) ?? Infinity)
    - Number(right.sortOrder ?? getBracketMatchNumber(right) ?? Infinity);
  if (sortOrder) return sortOrder;

  return new Date(left.date ?? 0) - new Date(right.date ?? 0);
}

function getKnockoutStageKey(stage) {
  const key = normalizeTeamName(stage ?? "");
  return knockoutStageByMatchStage[key] ?? null;
}

function mapMatchToBracketMatch(match, standings = []) {
  const stage = getKnockoutStageKey(match.stage);
  const matchNumber = inferBracketMatchNumber(match, stage, standings);
  return {
    id: match.id,
    matchNumber,
    stage: stageLabels[stage] ?? match.stage,
    slot: match.slot ?? (matchNumber ? formatStageSlot(stage, getStageOrderIndex(stage, matchNumber)) : match.stage),
    sortOrder: matchNumber ? getStageSortOrder(stage, matchNumber) : undefined,
    date: match.date,
    status: match.status,
    venue: match.venue,
    home: match.home,
    away: match.away,
    homeScore: match.homeScore ?? match.score?.home ?? null,
    awayScore: match.awayScore ?? match.score?.away ?? null,
  };
}

function inferBracketMatchNumber(match, stage, standings) {
  if (stage === "round32") {
    return inferRound32MatchNumber(match, standings);
  }
  return getBracketMatchNumber(match);
}

function inferRound32MatchNumber(match, standings) {
  const fixture = round32Fixtures.find((item) =>
    seedMatchesTeam(item.home, match.home, standings)
      && seedMatchesTeam(item.away, match.away, standings)
  );
  return fixture?.match ?? null;
}

function seedMatchesTeam(seed, team, standings) {
  if (seed.type === "rank") {
    return sameTeam(getGroupTeamByRank(standings, seed.group, seed.rank)?.name, team);
  }

  if (seed.type === "third") {
    return seed.groups.some((groupLetter) => {
      const third = getGroupTeamByRank(standings, groupLetter, 3);
      return third && sameTeam(third.name, team);
    });
  }

  return false;
}

function isSameBracketMatch(left, right) {
  if (left.id && right.id) {
    return String(left.id) === String(right.id);
  }

  return Boolean(
    left.date
      && right.date
      && left.date === right.date
      && left.home === right.home
      && left.away === right.away
  );
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Impossible de charger ${path}`);
  }
  return response.json();
}

// Charge un dataset depuis le Worker (donnees temps reel), avec repli sur le fichier local.
async function fetchData(name) {
  try {
    return await fetchJson(`${DATA_BASE}/${name}`);
  } catch (error) {
    console.warn(`Worker indisponible pour "${name}", repli sur ${LOCAL_DATA_FILES[name]}`, error);
    return fetchJson(LOCAL_DATA_FILES[name]);
  }
}

function bindNavigation() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  });

  document.querySelectorAll(".standing-view-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeStandingView = button.dataset.standingsView;
      renderStandingViews();
    });
  });

  els.groupsGrid?.addEventListener("click", handleTeamSurfaceClick);
  els.groupsGrid?.addEventListener("keydown", handleTeamSurfaceKeydown);
  els.bestThirdBoard?.addEventListener("click", handleTeamSurfaceClick);
  els.bestThirdBoard?.addEventListener("keydown", handleTeamSurfaceKeydown);
}

function bindMatchModal() {
  els.matchModalClose?.addEventListener("click", closeMatchDetails);
  els.matchModal?.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-match-modal]")) {
      closeMatchDetails();
      return;
    }

    const team = event.target.closest("[data-team]");
    if (team) {
      event.preventDefault();
      event.stopPropagation();
      openTeamDetails(team.dataset.team);
      return;
    }

    const tab = event.target.closest("[data-detail-tab]");
    if (tab) {
      state.activeDetailTab = tab.dataset.detailTab;
      renderMatchModal();
    }
  });
  els.matchModal?.addEventListener("keydown", handleTeamSurfaceKeydown);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.teamModal?.hidden) {
      closeTeamDetails();
      return;
    }

    if (event.key === "Escape" && !els.matchModal?.hidden) {
      closeMatchDetails();
    }
  });
}

function bindTeamModal() {
  els.teamModalClose?.addEventListener("click", closeTeamDetails);
  els.teamModal?.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-team-modal]")) {
      closeTeamDetails();
      return;
    }

    const row = event.target.closest("[data-team-match-id]");
    if (!row) return;

    const match = findMatchById(row.dataset.teamMatchId);
    if (match) {
      closeTeamDetails();
      openMatchDetails(match);
    }
  });
}

function bindBracket() {
  els.prevStage.addEventListener("click", () => moveStage(-1));
  els.nextStage.addEventListener("click", () => moveStage(1));
  els.bracketStage.addEventListener("click", handleBracketClick);
  els.bracketStage.addEventListener("keydown", handleBracketKeydown);

  els.bracketStage.addEventListener("touchstart", (event) => {
    state.touchStartX = event.changedTouches[0].clientX;
  });

  els.bracketStage.addEventListener("touchend", (event) => {
    handleStageSwipe(event.changedTouches[0].clientX - state.touchStartX);
  });

  els.bracketStage.addEventListener("pointerdown", (event) => {
    state.touchStartX = event.clientX;
  });

  els.bracketStage.addEventListener("pointerup", (event) => {
    handleStageSwipe(event.clientX - state.touchStartX);
  });
}

function handleBracketClick(event) {
  const team = event.target.closest("[data-team]");
  if (team) {
    event.preventDefault();
    event.stopPropagation();
    openTeamDetails(team.dataset.team);
    return;
  }

  const card = event.target.closest(".bracket-match");
  if (!card) return;

  const match = findBracketDisplayMatch(card.dataset.matchId, card.dataset.matchNumber);
  if (match) {
    openMatchDetails(match);
  }
}

function handleBracketKeydown(event) {
  if (!["Enter", " "].includes(event.key)) return;
  const target = event.target.closest("[data-team], .bracket-match");
  if (!target) return;
  event.preventDefault();
  target.click();
}

function bindInstallPrompt() {
  if (!els.installButton) return;
  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    els.installButton.hidden = false;
  });

  els.installButton.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    els.installButton.hidden = true;
  });
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("service-worker.js");
  }
}

function selectDefaultMatch() {
  const live = state.matches.find((match) => match.status === "live");
  const upcoming = state.matches
    .filter((match) => match.status === "upcoming")
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
  const finished = [...state.matches]
    .filter((match) => match.status === "finished")
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  state.selectedMatchId = (live ?? upcoming ?? finished ?? state.matches[0])?.id ?? null;
}

function renderAll() {
  renderMatches();
  renderStandings();
  renderBracketTabs();
  renderBracket();
  updateRefreshPill();
}

function renderMatches() {
  els.matchesCount.textContent = `${state.matches.length} matchs`;
  const view = buildMatchesView();
  els.matchesList.innerHTML = view.total
    ? renderMatchesView(view)
    : `<div class="empty-state">Aucun match disponible.</div>`;
  els.matchesList.onclick = handleMatchesListClick;
  els.matchesList.onkeydown = handleMatchesListKeydown;
  window.requestAnimationFrame(scrollMatchesToUpcoming);
}

function buildMatchesView() {
  const live = getMatchesByStatus("live");
  const finished = getMatchesByStatus("finished").reverse();
  const upcoming = getMatchesByStatus("upcoming");

  return {
    live,
    finished,
    upcoming,
    total: live.length + finished.length + upcoming.length,
  };
}

function renderMatchesView(view) {
  return [
    view.live.length ? renderMatchFeedSection("En direct", view.live, "live") : "",
    view.finished.length ? renderMatchFeedSection("Terminés", view.finished, "finished") : "",
    view.upcoming.length ? renderMatchFeedSection("À venir", view.upcoming, "upcoming") : "",
  ].filter(Boolean).join("");
}

function renderMatchFeedSection(title, matches, section) {
  return `
    <section class="match-stream-section" data-match-section="${escapeHtml(section)}">
      <header class="match-stream-header">
        <h3>${escapeHtml(title)}</h3>
        <span>${matches.length}</span>
      </header>
      <div class="match-stream-list">
        ${renderMatchFeed(matches.map((match) => ({ match, section })))}
      </div>
    </section>
  `;
}

function scrollMatchesToUpcoming() {
  const upcoming = els.matchesList?.querySelector('[data-match-section="upcoming"]');
  if (!upcoming) return;
  upcoming.scrollIntoView({ block: "start" });
}

function renderMatchFeed(feed) {
  let currentDay = "";
  let currentRound = "";

  return feed.map(({ match, section }) => {
    const dayKey = getNoonDayKey(match.date);
    const roundKey = getMatchRoundKey(match);
    const separators = [];

    if (roundKey && roundKey !== currentRound) {
      separators.push(renderRoundSeparator(match, roundKey));
      currentRound = roundKey;
      currentDay = "";
    }

    if (dayKey && dayKey !== currentDay) {
      separators.push(renderDaySeparator(match.date));
      currentDay = dayKey;
    }

    return `${separators.join("")}${renderMatchCard(match, section)}`;
  }).join("");
}

function renderMatchCard(match, section = "") {
  return `
    <article class="match-card match-feed-card match-feed-${escapeHtml(section)}" role="button" tabindex="0" data-match-id="${escapeHtml(match.id)}">
      <span class="match-meta">
        <span>${renderInlineMeta([match.stage, formatDate(match.date)])}</span>
        ${renderStatus(match)}
      </span>
      <span class="match-line">
        ${renderMatchTeam(match.home, "home", true)}
        <span class="compact-score">${scoreText(match)}</span>
        ${renderMatchTeam(match.away, "away", true)}
      </span>
      ${match.status === "live" ? renderLiveCardScorers(match) : ""}
    </article>
  `;
}

function renderMatchTeam(team, side = "", interactive = true) {
  const attrs = interactive
    ? `role="button" tabindex="0" data-team="${escapeHtml(team ?? "")}"`
    : "";
  return `
    <span class="match-team match-team-${escapeHtml(side)}${interactive ? " team-link" : ""}" ${attrs}>
      ${renderTeamFlag(team, "flag-match")}
      <span class="team-name">${escapeHtml(displayTeamName(team))}</span>
    </span>
  `;
}

function renderLiveCardScorers(match) {
  const scorers = [
    ...getTeamScorers(match, "home"),
    ...getTeamScorers(match, "away"),
  ];
  if (!scorers.length) return "";

  return `
    <div class="match-card-scorers">
      ${scorers.map((scorer) => `<span>${escapeHtml(scorer)}</span>`).join("")}
    </div>
  `;
}

function renderDaySeparator(date) {
  return `
    <div class="match-day-separator">
      <span>${escapeHtml(formatNoonDayLabel(date))}</span>
    </div>
  `;
}

function renderRoundSeparator(match, roundKey) {
  return `
    <div class="match-round-separator">
      <span>${escapeHtml(formatMatchRoundLabel(match, roundKey))}</span>
    </div>
  `;
}

function renderMatchSection(title, matches, emptyText) {
  return `
    <section class="match-section">
      <header class="match-section-header">
        <h3>${escapeHtml(title)}</h3>
        <span>${matches.length}</span>
      </header>
      <div class="match-section-list">
        ${matches.length ? matches.map(renderMatchCard).join("") : `<div class="empty-state">${escapeHtml(emptyText)}</div>`}
      </div>
    </section>
  `;
}

function getMatchesByStatus(status) {
  const matches = state.matches.filter((match) => match.status === status);
  return matches.sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    return status === "finished" ? dateB - dateA : dateA - dateB;
  });
}

function getNoonDayKey(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  date.setHours(date.getHours() - 12, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function formatNoonDayLabel(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "Jour à confirmer";
  const shifted = new Date(date);
  shifted.setHours(shifted.getHours() - 12);
  const start = new Date(shifted);
  start.setHours(12, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return `${start.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "short" })} midi - ${end.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} midi`;
}

function getMatchRoundKey(match) {
  const stageKey = getKnockoutStageKey(match.stage);
  if (stageKey) return `knockout-${stageKey}`;

  const round = getGroupMatchRound(match);
  return round ? `group-${round}` : "";
}

function formatMatchRoundLabel(match, roundKey) {
  if (roundKey.startsWith("group-")) {
    return `Journée ${roundKey.replace("group-", "")}`;
  }

  const stageKey = getKnockoutStageKey(match.stage);
  return stageKey ? stageLabels[stageKey] : "Matchs";
}

function getGroupMatchRound(match) {
  if (getKnockoutStageKey(match.stage)) return null;
  const homeRound = getTeamMatchRound(match.home, match);
  const awayRound = getTeamMatchRound(match.away, match);
  return Math.max(homeRound ?? 0, awayRound ?? 0) || null;
}

function getTeamMatchRound(teamName, targetMatch) {
  if (!teamName || !targetMatch?.date) return null;
  const teamMatches = state.matches
    .filter((match) => !getKnockoutStageKey(match.stage))
    .filter((match) => sameTeam(match.home, teamName) || sameTeam(match.away, teamName))
    .sort((left, right) => new Date(left.date) - new Date(right.date));
  const index = teamMatches.findIndex((match) => String(match.id) === String(targetMatch.id));
  return index >= 0 ? index + 1 : null;
}

function handleMatchesListClick(event) {
  const team = event.target.closest("[data-team]");
  if (team) {
    event.preventDefault();
    event.stopPropagation();
    openTeamDetails(team.dataset.team);
    return;
  }

  const clearTeam = event.target.closest("[data-clear-team]");
  if (clearTeam) {
    state.selectedTeam = null;
    renderMatches();
    return;
  }

  const card = event.target.closest(".match-card");
  const teamMatchRow = event.target.closest(".team-match-row");
  const targetMatch = card ?? teamMatchRow;
  if (!targetMatch) return;

  const match = findMatchById(targetMatch.dataset.matchId);
  if (match) openMatchDetails(match);
}

function handleMatchesListKeydown(event) {
  if (!["Enter", " "].includes(event.key)) return;
  const target = event.target.closest("[data-team], [data-clear-team], .match-card, .team-match-row");
  if (!target) return;
  event.preventDefault();
  target.click();
}

function handleTeamSurfaceClick(event) {
  const team = event.target.closest("[data-team]");
  if (!team) return;
  event.preventDefault();
  openTeamDetails(team.dataset.team);
}

function handleTeamSurfaceKeydown(event) {
  if (!["Enter", " "].includes(event.key)) return;
  const team = event.target.closest("[data-team]");
  if (!team) return;
  event.preventDefault();
  openTeamDetails(team.dataset.team);
}

function selectTeam(team) {
  if (!team) return;
  state.selectedTeam = team;
  renderMatches();
  document.querySelector(".team-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderTeamHistory(team) {
  const teamMatches = state.matches
    .filter((match) => sameTeam(match.home, team) || sameTeam(match.away, team))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const played = teamMatches.filter((match) => match.status === "finished");
  const next = teamMatches.find((match) => match.status !== "finished");

  return `
    <section class="team-panel">
      <header>
        <div>
          <p class="eyebrow">Parcours équipe</p>
          <h3>${escapeHtml(displayTeamName(team))}</h3>
        </div>
        <button class="icon-button" type="button" data-clear-team aria-label="Fermer le parcours">×</button>
      </header>
      <div class="team-summary-grid">
        <span><strong>${played.length}</strong><small>matchs joués</small></span>
        <span><strong>${teamRecord(played, team).wins}</strong><small>victoires</small></span>
        <span><strong>${teamRecord(played, team).draws}</strong><small>nuls</small></span>
        <span><strong>${teamRecord(played, team).losses}</strong><small>défaites</small></span>
      </div>
      ${next ? `<p class="team-next">Prochain match : ${escapeHtml(displayTeamName(next.home))} - ${escapeHtml(displayTeamName(next.away))}, ${escapeHtml(formatDate(next.date))}</p>` : ""}
      <div class="team-match-list">
        ${teamMatches.map((match) => `
          <button class="team-match-row" type="button" data-match-id="${escapeHtml(match.id)}">
            <span>${escapeHtml(formatDate(match.date))}</span>
            <strong>${escapeHtml(displayTeamName(match.home))} ${scoreText(match)} ${escapeHtml(displayTeamName(match.away))}</strong>
            ${renderStatus(match)}
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function teamRecord(matches, team) {
  return matches.reduce((record, match) => {
    if (!hasMatchScore(match)) return record;
    const isHome = sameTeam(match.home, team);
    const own = isHome ? match.score.home : match.score.away;
    const against = isHome ? match.score.away : match.score.home;
    if (own > against) record.wins += 1;
    else if (own === against) record.draws += 1;
    else record.losses += 1;
    return record;
  }, { wins: 0, draws: 0, losses: 0 });
}

function findMatchById(matchId) {
  return state.matches.find((match) => String(match.id) === String(matchId)) ?? null;
}

function findBracketDisplayMatch(matchId, matchNumber) {
  const realMatch = findMatchById(matchId);
  if (realMatch) return realMatch;

  return stageOrder
    .flatMap((stage) => state.knockout?.[stage] ?? [])
    .find((match) =>
      String(match.id) === String(matchId)
        || String(getBracketMatchNumber(match)) === String(matchNumber)
    ) ?? null;
}

function openMatchDetails(match) {
  state.detailMatch = hydrateDetailMatch(match);
  state.activeDetailTab = getDetailTabs(state.detailMatch)[0]?.key ?? "experts";
  renderMatchModal();
  els.matchModal.hidden = false;
  resetModalScroll(els.matchModalBody);
  document.body.classList.add("has-modal");
}

function closeMatchDetails(options = {}) {
  if (options.closeTeam !== false && els.teamModal && !els.teamModal.hidden) {
    closeTeamDetails({ closeMatch: false });
  }

  els.matchModal.hidden = true;
  state.detailMatch = null;
  state.activeDetailTab = null;
  updateModalBodyLock();
}

function openTeamDetails(team) {
  if (!isConcreteTeam(team)) return;
  state.detailTeam = findCanonicalTeamName(team);
  renderTeamModal();
  els.teamModal.hidden = false;
  resetModalScroll(els.teamModalBody);
  updateModalBodyLock();
}

function closeTeamDetails(options = {}) {
  if (options.closeMatch !== false && els.matchModal && !els.matchModal.hidden) {
    closeMatchDetails({ closeTeam: false });
  }

  els.teamModal.hidden = true;
  state.detailTeam = null;
  updateModalBodyLock();
}

function updateModalBodyLock() {
  const hasOpenModal = Boolean((els.matchModal && !els.matchModal.hidden) || (els.teamModal && !els.teamModal.hidden));
  document.body.classList.toggle("has-modal", hasOpenModal);
}

function resetModalScroll(body) {
  if (!body) return;
  body.scrollTop = 0;
  window.requestAnimationFrame(() => {
    body.scrollTop = 0;
  });
}

function renderTeamModal() {
  const team = state.detailTeam;
  if (!team) return;

  const profile = getTeamProfile(team);
  els.teamModalTitle.innerHTML = `
    <div class="team-modal-title-row">
      ${renderTeamFlag(team, "flag-detail")}
      <div>
        <p class="eyebrow">Fiche équipe</p>
        <h2>${escapeHtml(displayTeamName(team))}</h2>
        <span class="team-state-badge team-state-${escapeHtml(profile.status.key)}">${escapeHtml(profile.status.label)}</span>
      </div>
    </div>
  `;
  els.teamModalBody.innerHTML = renderTeamProfile(profile);
}

function getTeamProfile(team) {
  const matches = getTeamMatches(team);
  const played = matches.filter((match) => match.status === "finished" && hasMatchScore(match));
  return {
    team,
    status: getTeamCurrentStatus(team),
    matches,
    played,
    form: played.slice(-5),
    lineup: getTeamLineupProfile(team),
  };
}

function renderTeamProfile(profile) {
  return `
    <section class="team-detail-section">
      <h3>Forme récente</h3>
      ${renderTeamForm(profile.form, profile.team)}
    </section>
    <section class="team-detail-section">
      <h3>Compo type</h3>
      ${renderTeamLineupProfile(profile.lineup)}
    </section>
    <section class="team-detail-section">
      <h3>Derniers matchs</h3>
      ${renderTeamRecentMatches(profile.matches)}
    </section>
  `;
}

function renderTeamForm(matches, team) {
  if (!matches.length) return `<p class="muted">Aucun match terminé disponible pour cette équipe.</p>`;

  return `
    <div class="team-form-dots" aria-label="Derniers résultats">
      ${matches.map((match) => {
        const result = getTeamMatchResult(match, team);
        return `<span class="form-dot form-${escapeHtml(result.key)}" title="${escapeHtml(result.label)}"></span>`;
      }).join("")}
    </div>
  `;
}

function renderTeamLineupProfile(profile) {
  const players = Array.isArray(profile?.lineup?.players) ? profile.lineup.players.filter(Boolean) : [];
  if (!profile?.lineup || !players.length) {
    return `<p class="muted">Composition non disponible pour le moment.</p>`;
  }

  const source = formatLineupSource(profile.lineup);
  return `
    <div class="team-lineup-card">
      <div class="team-lineup-meta">
        <span>${escapeHtml(profile.lineup.formation ?? "Formation à confirmer")}</span>
        ${profile.coach ? `<span>Entraîneur : ${escapeHtml(profile.coach)}</span>` : ""}
      </div>
      ${source ? `<small class="lineup-source">${escapeHtml(source)}</small>` : ""}
      <div class="lineup-field lineup-field-team">
        ${renderLineupTeam(profile.lineup, "single", "team")}
      </div>
    </div>
  `;
}

function renderTeamRecentMatches(matches) {
  const rows = matches
    .filter((match) => match.status === "finished" || match.status === "live" || match.status === "upcoming")
    .slice()
    .sort((left, right) => new Date(right.date) - new Date(left.date))
    .slice(0, 6);

  if (!rows.length) return `<p class="muted">Aucun match disponible pour cette équipe.</p>`;

  return `
    <div class="team-recent-list">
      ${rows.map((match) => `
        <button class="team-recent-row" type="button" data-team-match-id="${escapeHtml(match.id)}">
          <span>${escapeHtml(formatDate(match.date))}</span>
          <strong>
            ${renderTeamFlag(match.home, "flag-inline")}
            ${escapeHtml(displayTeamName(match.home))}
            <b>${escapeHtml(scoreText(match))}</b>
            ${escapeHtml(displayTeamName(match.away))}
            ${renderTeamFlag(match.away, "flag-inline")}
          </strong>
          ${renderStatus(match)}
        </button>
      `).join("")}
    </div>
  `;
}

function getTeamCurrentStatus(team) {
  const knockoutLoss = getTeamKnockoutLoss(team);
  if (knockoutLoss) return { key: "eliminated", label: "Éliminé" };

  const finalWinner = getTeamFinalWin(team);
  if (finalWinner) return { key: "champion", label: "Champion" };

  const stage = getTeamConcreteKnockoutStage(team);
  if (stage) return { key: stage, label: teamStageStatusLabels[stage] ?? stageLabels[stage] };

  const standing = findStandingTeam(team);
  if (!standing) return { key: "unknown", label: "En course" };

  const status = getTeamQualificationStatus(
    standing.group,
    standing.team,
    getCurrentBestThirdKeySet(),
    areAllGroupsComplete()
  );

  if (status.key === "qualified" || status.key === "best-third") {
    return { key: "round32", label: teamStageStatusLabels.round32 };
  }

  if (String(status.label).startsWith("(")) {
    return { key: "unknown", label: "En course" };
  }

  return { key: "eliminated", label: "Éliminé" };
}

const teamStageStatusLabels = {
  round32: "En 16es",
  round16: "En 8es",
  quarterfinals: "En quarts",
  semifinals: "En demies",
  final: "En finale",
};

function getTeamConcreteKnockoutStage(team) {
  return [...stageOrder].reverse().find((stage) =>
    (state.knockout?.[stage] ?? []).some((match) =>
      sameTeam(match.home, team) || sameTeam(match.away, team)
    )
  ) ?? null;
}

function getTeamKnockoutLoss(team) {
  return getTeamMatches(team)
    .filter((match) => match.status === "finished" && getKnockoutStageKey(match.stage))
    .find((match) => {
      if (!hasMatchScore(match)) return false;
      const result = getTeamMatchResult(match, team);
      return result.key === "loss";
    }) ?? null;
}

function getTeamFinalWin(team) {
  return getTeamMatches(team)
    .filter((match) => match.status === "finished" && getKnockoutStageKey(match.stage) === "final")
    .find((match) => getTeamMatchResult(match, team).key === "win") ?? null;
}

function getTeamLineupProfile(team) {
  const cardLineup = buildCardLineup(team, { source: "Notes estimées par de fins connaisseurs" });
  if (cardLineup?.players?.length) {
    return {
      match: null,
      lineup: cardLineup,
      coach: "",
    };
  }

  const matches = getTeamMatches(team).slice().sort((left, right) => new Date(right.date) - new Date(left.date));
  const withOfficialLineup = matches.find((match) => getTeamLineupFromMatch(match, team, "lineups")?.lineup?.players?.length);
  const withProbableLineup = matches.find((match) => getTeamLineupFromMatch(match, team, "probableLineups")?.lineup?.players?.length);
  return withOfficialLineup
    ? getTeamLineupFromMatch(withOfficialLineup, team, "lineups")
    : getTeamLineupFromMatch(withProbableLineup, team, "probableLineups");
}

function getTeamLineupFromMatch(match, team, key) {
  if (!match) return null;
  const side = getTeamSide(match, team);
  if (!side) return null;
  return {
    match,
    lineup: match[key]?.[side] ?? null,
    coach: match[`${side}Coach`] ?? "",
  };
}

function getTeamSide(match, team) {
  if (sameTeam(match.home, team)) return "home";
  if (sameTeam(match.away, team)) return "away";
  return "";
}

function getTeamMatches(team) {
  return state.matches
    .filter((match) => sameTeam(match.home, team) || sameTeam(match.away, team))
    .sort((left, right) => new Date(left.date) - new Date(right.date));
}

function getTeamMatchResult(match, team) {
  if (!hasMatchScore(match)) return { key: "draw", label: "Nul" };
  const isHome = sameTeam(match.home, team);
  const own = isHome ? match.score.home : match.score.away;
  const against = isHome ? match.score.away : match.score.home;
  if (own > against) return { key: "win", label: "Victoire" };
  if (own < against) return { key: "loss", label: "Défaite" };
  return { key: "draw", label: "Nul" };
}

function hydrateDetailMatch(match) {
  if (!match) return null;
  const realMatch = findMatchById(match.id);
  if (realMatch) return realMatch;

  const byTeams = state.matches.find((candidate) =>
    sameTeam(candidate.home, match.home) && sameTeam(candidate.away, match.away)
  );
  return byTeams ?? {
    ...match,
    status: match.status ?? "projected",
    score: {
      home: match.homeScore ?? null,
      away: match.awayScore ?? null,
    },
    expertDiscussion: match.expertDiscussion ?? [],
  };
}

function renderMatchModal() {
  const match = state.detailMatch;
  if (!match) return;

  const tabs = getDetailTabs(match);
  if (!tabs.some((tab) => tab.key === state.activeDetailTab)) {
    state.activeDetailTab = tabs[0]?.key ?? "experts";
  }

  els.matchModalTitle.innerHTML = renderMatchModalTitle(match);
  els.matchModalTabs.innerHTML = tabs.map((tab) => `
    <button
      class="match-modal-tab${tab.key === state.activeDetailTab ? " is-active" : ""}"
      type="button"
      data-detail-tab="${escapeHtml(tab.key)}"
      role="tab"
      aria-selected="${tab.key === state.activeDetailTab}"
    >
      ${escapeHtml(tab.label)}
    </button>
  `).join("");
  els.matchModalBody.innerHTML = renderDetailTab(match, state.activeDetailTab);
}

function renderMatchModalTitle(match) {
  return `
    <p class="eyebrow">${renderInlineMeta([match.stage, match.venue, formatDate(match.date)])}</p>
    <div class="modal-score-row">
      <span class="modal-team-link" role="button" tabindex="0" data-team="${escapeHtml(match.home ?? "")}" aria-label="Ouvrir la fiche ${escapeHtml(displayTeamName(match.home))}">${renderTeamFlag(match.home, "flag-inline")} ${escapeHtml(displayTeamName(match.home))}</span>
      <strong>${escapeHtml(scoreText(match))}</strong>
      <span class="modal-team-link" role="button" tabindex="0" data-team="${escapeHtml(match.away ?? "")}" aria-label="Ouvrir la fiche ${escapeHtml(displayTeamName(match.away))}">${renderTeamFlag(match.away, "flag-inline")} ${escapeHtml(displayTeamName(match.away))}</span>
    </div>
  `;
}

function getDetailTabs(match) {
  if (match.status === "live") {
    return [
      { key: "lineups", label: "Compo actuelle" },
      { key: "odds", label: "Paris" },
      { key: "watch", label: "M6+" },
      { key: "experts", label: "Experts" },
    ];
  }

  if (match.status === "finished") {
    return [
      { key: "summary", label: "Résumé" },
      { key: "experts", label: "Experts" },
    ];
  }

  return [
    { key: "lineups", label: "Compo probable" },
    { key: "odds", label: "Paris" },
    { key: "experts", label: "Experts" },
  ];
}

function renderDetailTab(match, tab) {
  if (tab === "lineups") {
    const lineups = match.status === "live" ? match.lineups : match.probableLineups;
    const title = match.status === "live"
      ? "Compo actuelle"
      : lineupSectionTitle(lineups, "Compo probable");
    return renderLineups(getDisplayLineupsForMatch(match, lineups), title);
  }

  if (tab === "odds") {
    return `
      <section class="detail-section">
        <h3>Notre sélection de paris</h3>
        <div class="odds-table">${renderBetSuggestions(match)}</div>
      </section>
    `;
  }

  if (tab === "watch") {
    return renderShortcutSection("Regarder", "Ouvrir M6+", m6PlusUrl, "Raccourci vers M6+ pour regarder le direct.");
  }

  if (tab === "summary") {
    return renderShortcutSection("Résumé", "Chercher le résumé", m6YoutubeSearchUrl, "Raccourci vers M6+ / YouTube pour retrouver le résumé dès qu'il est publié.");
  }

  return renderExpertPanel(match);
}

function renderShortcutSection(title, label, url, description) {
  return `
    <section class="detail-section">
      <h3>${escapeHtml(title)}</h3>
      <p class="muted">${escapeHtml(description)}</p>
      <a class="external-link-button" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>
    </section>
  `;
}

function renderExpertPanel(match) {
  const messages = Array.isArray(match.expertDiscussion) ? match.expertDiscussion.filter(Boolean) : [];
  return `
    <section class="detail-section">
      <h3>Discussions de nos experts</h3>
      <div class="expert-chat">
        ${
          messages.length
            ? messages.map((message, index) => `
              <div class="expert-message">
                <strong>Expert ${index + 1}</strong>
                <span>${escapeHtml(message)}</span>
              </div>
            `).join("")
            : `<p class="muted">Espace prêt pour les discussions d'avant-match et les analyses live.</p>`
        }
      </div>
    </section>
  `;
}

function getTeamScorers(match, side) {
  const team = match?.[side];
  const teamKey = normalizeTeamName(team);
  if (!teamKey || !Array.isArray(match?.scorers)) return [];

  return match.scorers.filter((scorer) => normalizeTeamName(getScoringTeam(match, scorer)) === teamKey);
}

function getScoringTeam(match, scorer) {
  const scorerTeam = extractScorerTeam(scorer);
  if (!isOwnGoal(scorer)) return scorerTeam;

  const scorerTeamKey = normalizeTeamName(scorerTeam);
  if (scorerTeamKey === normalizeTeamName(match?.home)) return match?.away ?? scorerTeam;
  if (scorerTeamKey === normalizeTeamName(match?.away)) return match?.home ?? scorerTeam;
  return scorerTeam;
}

function isOwnGoal(scorer) {
  return String(scorer ?? "").toLocaleLowerCase("fr-FR").includes("contre son camp");
}

function extractScorerTeam(scorer) {
  const matches = String(scorer ?? "").match(/\(([^()]*)\)/g);
  if (!matches?.length) return "";
  return matches[matches.length - 1].slice(1, -1);
}

function formatTeamScorer(scorer, team) {
  const teamPattern = new RegExp(`\\s*\\(${escapeRegExp(team)}\\)`, "u");
  return String(scorer ?? "")
    .replace(teamPattern, "")
    .replace(/^\s*(\d+(?:'\+\d+)?')\s+But de\s+/i, "$1 ")
    .replace(/\s*!\s*$/, "")
    .trim();
}

function normalizeTeamName(team) {
  return String(team ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'._-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr-FR");
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getDisplayLineupsForMatch(match, fallbackLineups) {
  if (!match) return fallbackLineups;

  return {
    home: getDisplayLineupForSide(match, "home", fallbackLineups),
    away: getDisplayLineupForSide(match, "away", fallbackLineups),
  };
}

function getDisplayLineupForSide(match, side, fallbackLineups) {
  const fallback = fallbackLineups?.[side] ?? null;
  if (match.status === "live") return fallback;

  const team = fallback?.team ?? match?.[side];
  const cardLineup = buildCardLineup(team, {
    fallbackFormation: fallback?.formation,
    source: "Notes estimées par de fins connaisseurs",
  });

  return cardLineup?.players?.length ? cardLineup : fallback;
}

function buildCardLineup(team, options = {}) {
  const cardPlayers = getTeamCardPlayers(team);
  if (!cardPlayers.length) return null;

  const selectedPlayers = selectCardLineupPlayers(team, cardPlayers);
  if (!selectedPlayers.length) return null;

  return {
    team: displayTeamName(team),
    formation: options.fallbackFormation || inferFormationFromCardPlayers(selectedPlayers),
    players: selectedPlayers,
    source: options.source ?? "Notes estimées par de fins connaisseurs",
  };
}

function getTeamCardPlayers(team) {
  const entry = getTeamCardEntry(team);
  if (!entry) return [];

  const starters = Array.isArray(entry.joueurs) ? entry.joueurs : [];
  const substitutes = Array.isArray(entry.remplacants) ? entry.remplacants : [];
  const seen = new Set();

  return [...starters, ...substitutes].reduce((players, player, index) => {
    const name = player?.nom ?? player?.name;
    const key = normalizePlayerName(name);
    if (!key || seen.has(key)) return players;

    seen.add(key);
    players.push({
      ...player,
      sourceIndex: index,
      starterIndex: index < starters.length ? index : null,
    });
    return players;
  }, []);
}

function getTeamCardEntry(team) {
  const teams = state.playerCards?.equipes;
  if (!teams) return null;
  const entry = Object.entries(teams).find(([teamName]) => sameTeam(teamName, team));
  return entry?.[1] ?? null;
}

function selectCardLineupPlayers(team, players) {
  if (players.length <= 11) return players.slice(0, 11);

  const forcedPlayers = getForcedCardStarters(team, players);
  const recentScores = getRecentCardPlayerScores(team);
  const ranked = players
    .map((player) => ({
      player,
      score: recentScores.get(normalizePlayerName(player.nom)) ?? 0,
      starterBias: player.starterIndex === null ? 0 : 1,
    }))
    .sort((left, right) =>
      right.score - left.score
        || right.starterBias - left.starterBias
        || (left.player.sourceIndex ?? 0) - (right.player.sourceIndex ?? 0)
    );

  const picked = [...forcedPlayers];
  ranked.forEach((item) => {
    if (picked.length >= 11) return;
    if (picked.some((player) => normalizePlayerName(player.nom) === normalizePlayerName(item.player.nom))) return;
    picked.push(item.player);
  });

  return picked.sort((left, right) => (left.sourceIndex ?? 0) - (right.sourceIndex ?? 0));
}

function getForcedCardStarters(team, players) {
  const forcedNames = forcedCardStartersByTeam[normalizeTeamName(displayTeamName(team))] ?? [];
  if (!forcedNames.length) return [];

  return forcedNames
    .map((forcedName) => players.find((player) => normalizePlayerName(player.nom) === normalizePlayerName(forcedName)))
    .filter(Boolean);
}

function getRecentCardPlayerScores(team) {
  const scores = new Map();
  getTeamMatches(team)
    .slice()
    .sort((left, right) => new Date(right.date) - new Date(left.date))
    .slice(0, 5)
    .forEach((match, matchIndex) => {
      ["lineups", "probableLineups"].forEach((lineupKey) => {
        const fromMatch = getTeamLineupFromMatch(match, team, lineupKey);
        const players = Array.isArray(fromMatch?.lineup?.players) ? fromMatch.lineup.players : [];
        const sourceWeight = lineupKey === "lineups" ? 2 : 1;
        players.forEach((player, playerIndex) => {
          const parsed = parseLineupPlayer(player);
          const card = findPlayerCard(team, parsed.name);
          if (!card?.nom) return;

          const key = normalizePlayerName(card.nom);
          const recencyWeight = Math.max(1, 5 - matchIndex);
          const orderWeight = Math.max(1, 11 - playerIndex);
          scores.set(key, (scores.get(key) ?? 0) + sourceWeight * recencyWeight * orderWeight);
        });
      });
    });

  return scores;
}

function inferFormationFromCardPlayers(players) {
  const counts = players.reduce((record, player) => {
    const role = getPositionRole(player?.poste ?? player?.position);
    if (role === "defender") record.defenders += 1;
    if (role === "midfielder") record.midfielders += 1;
    if (role === "forward") record.forwards += 1;
    return record;
  }, { defenders: 0, midfielders: 0, forwards: 0 });

  if (!counts.defenders && !counts.midfielders && !counts.forwards) return null;
  return [counts.defenders, counts.midfielders, counts.forwards].filter((value) => value > 0).join("-");
}

function renderLineups(lineups, title) {
  const blocks = ["home", "away"].map((side) =>
    renderLineupTeam(lineups?.[side], side, "match")
  ).filter(Boolean);

  return `
    <section class="detail-section">
      <h3>${title}</h3>
      ${
        blocks.length
          ? `
            <div class="lineup-field lineup-field-match">
              ${blocks[0] ?? ""}
              ${blocks.length > 1 ? `<div class="lineup-midline" aria-hidden="true"></div>` : ""}
              ${blocks[1] ?? ""}
            </div>
          `
          : `<p class="muted">Compositions non disponibles pour le moment</p>`
      }
    </section>
  `;
}

function renderLineupTeam(lineup, side, mode) {
  const players = Array.isArray(lineup?.players) ? lineup.players.filter(Boolean) : [];
  if (!lineup || !players.length) return "";

  const orderedRoles = getLineupRoleOrder(side, mode);
  const rows = groupLineupPlayers(players, lineup.team, orderedRoles);
  const source = mode === "match" ? formatLineupSource(lineup) : "";

  return `
    <div class="lineup-team lineup-team-${escapeHtml(side)}">
      <div class="lineup-team-header">
        <strong>${lineup.team ? escapeHtml(displayTeamName(lineup.team)) : "Équipe"}</strong>
        ${lineup.formation ? `<span>${escapeHtml(lineup.formation)}</span>` : ""}
        ${source ? `<small class="lineup-source">${escapeHtml(source)}</small>` : ""}
      </div>
      <div class="lineup-lines">
        ${rows.map((row) => `
          <div class="lineup-role-row lineup-role-${escapeHtml(row.role)}">
            ${row.players.map(renderLineupPlayerCard).join("")}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function getLineupRoleOrder(side, mode) {
  if (mode === "team") return ["forward", "midfielder", "defender", "keeper", "unknown"];
  if (side === "away") return ["forward", "midfielder", "defender", "keeper", "unknown"];
  return ["keeper", "defender", "midfielder", "forward", "unknown"];
}

function groupLineupPlayers(players, team, orderedRoles) {
  const groups = new Map(orderedRoles.map((role) => [role, []]));
  players.forEach((player, index) => {
    const enriched = enrichLineupPlayer(player, team, index, players.length);
    const role = groups.has(enriched.role) ? enriched.role : "unknown";
    groups.get(role).push(enriched);
  });

  return orderedRoles
    .map((role) => ({ role, players: groups.get(role) ?? [] }))
    .filter((row) => row.players.length);
}

function enrichLineupPlayer(player, team, index, totalPlayers) {
  const parsed = parseLineupPlayer(player);
  const card = getDirectPlayerCard(player) ?? findPlayerCard(team, parsed.name);
  const position = card?.poste ?? parsed.position;

  return {
    name: card?.nom ?? parsed.name,
    position,
    role: getPositionRole(position) || inferLineupRole(index, totalPlayers),
    club: cleanOptionalCardValue(card?.club),
    rating: card?.note,
    age: card?.age,
  };
}

function getDirectPlayerCard(player) {
  if (!player || typeof player !== "object") return null;
  return player.nom && (player.poste || player.club || player.note || player.age) ? player : null;
}

function parseLineupPlayer(player) {
  if (player && typeof player === "object") {
    return {
      name: String(player.name ?? player.nom ?? player.player?.name ?? "").trim(),
      position: String(player.position ?? player.poste ?? player.pos ?? player.player?.pos ?? "").trim(),
    };
  }

  const text = String(player ?? "").trim();
  const withoutNumber = text.replace(/^\d+\.\s*/u, "").trim();
  const positionMatch = withoutNumber.match(/\(([^()]*)\)\s*$/u);
  return {
    name: (positionMatch ? withoutNumber.slice(0, positionMatch.index) : withoutNumber).trim(),
    position: positionMatch?.[1]?.trim() ?? "",
  };
}

function findPlayerCard(team, playerName) {
  if (!playerName) return null;
  const entry = getTeamCardEntry(team);
  if (!entry) return null;

  const players = [
    ...(Array.isArray(entry?.joueurs) ? entry.joueurs : []),
    ...(Array.isArray(entry?.remplacants) ? entry.remplacants : []),
  ];
  return players.find((card) => playerNameMatches(playerName, card?.nom)) ?? null;
}

function playerNameMatches(lineupName, cardName) {
  const lineup = normalizePlayerName(lineupName);
  const card = normalizePlayerName(cardName);
  if (!lineup || !card) return false;
  if (lineup === card) return true;

  const lineupParts = lineup.split(" ");
  const cardParts = card.split(" ");
  const lineupLast = lineupParts[lineupParts.length - 1];
  const cardLast = cardParts[cardParts.length - 1];
  if (!lineupLast || lineupLast !== cardLast) return false;

  const lineupInitial = lineupParts[0]?.[0] ?? "";
  const cardInitial = cardParts[0]?.[0] ?? "";
  return Boolean(lineupInitial && lineupInitial === cardInitial);
}

function normalizePlayerName(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^\d+\.\s*/u, "")
    .replace(/\([^()]*(?:\)|$)/gu, " ")
    .replace(/[’'._-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr-FR");
}

function getPositionRole(position) {
  const value = normalizePlayerName(position).replace(/\s+/g, "").toLocaleUpperCase("fr-FR");
  if (!value) return "";
  if (value === "G" || value === "GK" || value.includes("GARDIEN")) return "keeper";
  if (value === "D" || value.startsWith("D") || value.includes("DEF")) return "defender";
  if (value === "M" || value.startsWith("M")) return "midfielder";
  if (value === "F" || value.startsWith("A") || ["BU", "ST", "CF"].includes(value)) return "forward";
  return "";
}

function inferLineupRole(index, totalPlayers) {
  if (totalPlayers >= 10) {
    if (index === 0) return "keeper";
    if (index <= 4) return "defender";
    if (index <= 7) return "midfielder";
    return "forward";
  }
  return "unknown";
}

function cleanOptionalCardValue(value) {
  const text = String(value ?? "").trim();
  if (!text || /^unknown$/iu.test(text)) return "";
  return text;
}

function renderLineupPlayerCard(player) {
  const position = cleanOptionalCardValue(player.position);
  const age = cleanOptionalCardValue(player.age);
  const rating = cleanOptionalCardValue(player.rating);
  const club = cleanOptionalCardValue(player.club);

  return `
    <article class="lineup-player-card">
      ${(position || age || rating) ? `
        <div class="lineup-card-top">
          ${(position || age) ? `
            <span class="lineup-card-stack">
              ${position ? `<b>${escapeHtml(position)}</b>` : ""}
              ${age ? `<small>${escapeHtml(age)}</small>` : ""}
            </span>
          ` : ""}
          ${rating ? `<span class="lineup-card-rating">${escapeHtml(rating)}</span>` : ""}
        </div>
      ` : ""}
      <div class="lineup-card-body">
        <strong>${escapeHtml(player.name)}</strong>
        ${club ? `<small>${escapeHtml(club)}</small>` : ""}
      </div>
    </article>
  `;
}

function lineupSectionTitle(lineups, fallback) {
  const sources = ["home", "away"]
    .map((side) => lineups?.[side]?.source)
    .filter(Boolean);
  if (sources.length && sources.every((source) => source === "Dernière compo connue")) {
    return "Dernières compos connues";
  }
  return fallback;
}

function formatLineupSource(lineup) {
  if (!lineup?.source) return "";
  const parts = [lineup.source];
  if (lineup.sourceDate) parts.push(formatDate(lineup.sourceDate));
  if (lineup.sourceMatch) parts.push(lineup.sourceMatch);
  return parts.join(" • ");
}

function renderBetSuggestions(match) {
  const suggestions = getBetSuggestions(match);
  const matchOdds = getMatchWinnerOdds(match);
  const probabilities = getPredictionRows(match);

  if (!suggestions.length && !matchOdds.length && !probabilities.length) {
    return `<p class="muted">Aucune cote disponible pour ce match pour le moment.</p>`;
  }

  return `
    <p class="muted">${matchOdds.length || suggestions.length ? "Cotes indicatives, à titre informatif uniquement. Elles peuvent bouger." : "Les cotes ne sont pas encore disponibles, voici les probabilités synchronisées."}</p>
    ${matchOdds.length ? renderMatchWinnerOdds(matchOdds) : ""}
    ${!matchOdds.length && probabilities.length ? renderPredictionRows(probabilities) : ""}
    ${suggestions.length ? `
      <div class="bet-card-grid">
        ${suggestions.map((bet) => `
          <article class="bet-card">
            <span>${escapeHtml(bet.market ?? "Paris")}</span>
            <strong>${escapeHtml(bet.label)}</strong>
            <footer>
              <small>Cote indicative</small>
              <b>${Number(bet.odd).toFixed(2)}</b>
            </footer>
          </article>
        `).join("")}
      </div>
    ` : ""}
  `;
}

function renderPredictionRows(probabilities) {
  return `
    <div class="match-winner-odds" aria-label="Probabilités du match">
      ${probabilities.map((row) => `
        <span>
          <small>${escapeHtml(row.label)}</small>
          <b>${escapeHtml(row.probability)}%</b>
        </span>
      `).join("")}
    </div>
  `;
}

function renderMatchWinnerOdds(matchOdds) {
  return `
    <div class="match-winner-odds" aria-label="Paris résultat du match">
      ${matchOdds.map((odd) => `
        <span>
          <small>${escapeHtml(odd.label)}</small>
          <b>${Number(odd.odd).toFixed(2)}</b>
        </span>
      `).join("")}
    </div>
  `;
}

function getBetSuggestions(match) {
  const detailed = getMatchLookupIds(match)
    .map((id) => state.betSuggestions[id])
    .find((rows) => Array.isArray(rows)) ?? [];
  if (detailed.length) {
    return detailed
      .filter((bet) => bet.bookmaker && bet.label && isNumber(bet.odd))
      .filter((bet) => normalizeTeamName(bet.market) !== "resultat du match")
      .slice(0, 10);
  }

  if (match.status === "finished") return [];

  const homeName = displayTeamName(match.home);
  const awayName = displayTeamName(match.away);

  return getOddsRows(match)
    .flatMap((book) => [
      { label: `Victoire ${homeName}`, bookmaker: book.bookmaker, odd: book.home },
      { label: "Match nul", bookmaker: book.bookmaker, odd: book.draw },
      { label: `Victoire ${awayName}`, bookmaker: book.bookmaker, odd: book.away },
    ])
    .filter((bet) => bet.bookmaker && isNumber(bet.odd))
    .sort((left, right) => right.odd - left.odd)
    .slice(0, 10);
}

function getMatchWinnerOdds(match) {
  if (match.status === "finished") return [];

  const stored = getMatchLookupIds(match)
    .map((id) => state.matchOdds[id])
    .find((rows) => Array.isArray(rows)) ?? [];
  if (stored.length) {
    return stored.filter((odd) => odd.label && isNumber(odd.odd));
  }

  const firstBook = getOddsRows(match)[0];
  if (!firstBook) return [];

  return [
    { label: displayTeamName(match.home), odd: firstBook.home },
    { label: "Nul", odd: firstBook.draw },
    { label: displayTeamName(match.away), odd: firstBook.away },
  ];
}

function getOddsRows(match) {
  const odds = getMatchLookupIds(match)
    .map((id) => state.odds[id])
    .find((rows) => Array.isArray(rows)) ?? [];
  return odds.filter((book) =>
    book.bookmaker && isNumber(book.home) && isNumber(book.draw) && isNumber(book.away)
  );
}

function getPredictionRows(match) {
  if (match.status === "finished") return [];
  const probabilities = match.winProbability || {};
  return [
    { label: displayTeamName(match.home), probability: probabilities.home },
    { label: "Nul", probability: probabilities.draw },
    { label: displayTeamName(match.away), probability: probabilities.away },
  ].filter((row) => isNumber(row.probability));
}

function getMatchLookupIds(match) {
  return [
    match?.id,
    match?.apiFootballFixtureId,
    match?.externalIds?.apiFootball,
  ]
    .filter((id) => id !== undefined && id !== null && id !== "")
    .map(String)
    .filter((id, index, ids) => ids.indexOf(id) === index);
}

function renderStandings() {
  if (els.standingsLegend) {
    els.standingsLegend.hidden = state.standings.length === 0;
  }

  const groups = sortGroupsByPhase(state.standings);
  const currentBestThirdKeys = getCurrentBestThirdKeySet();
  const allGroupsComplete = areAllGroupsComplete();

  els.groupsGrid.innerHTML = groups.length ? groups.map((group) => {
    const phase = getGroupPhase(group);
    return `
    <article class="group-card group-${phase.key}">
      <header>
        <h3>${escapeHtml(group.name ?? "Groupe")}</h3>
        <span class="group-phase">${escapeHtml(phase.label)}</span>
      </header>
      <div class="standings-table">
        <div class="standing-row is-head">
          <span class="team-cell">Équipe</span>
          <span class="standing-numbers"><span>J</span><span>Diff</span><span>Pts</span><span>Statut</span></span>
        </div>
        ${(Array.isArray(group.teams) ? group.teams : []).map((team) => `
          ${renderGroupTeamRow(group, team, currentBestThirdKeys, allGroupsComplete)}
        `).join("")}
      </div>
    </article>
  `;
  }).join("") : `<div class="empty-state">Aucun classement disponible.</div>`;

  els.bestThirdBoard.innerHTML = renderBestThirdBoard(currentBestThirdKeys, allGroupsComplete);
  els.topScorersBoard.innerHTML = renderPlayerBoard("Meilleurs buteurs", state.players.topScorers, "goals", "buts");
  els.topAssistsBoard.innerHTML = renderPlayerBoard("Meilleurs passeurs", state.players.topAssists, "assists", "passes");
  renderStandingViews();
}

function renderGroupTeamRow(group, team, currentBestThirdKeys, allGroupsComplete) {
  const status = getTeamQualificationStatus(group, team, currentBestThirdKeys, allGroupsComplete);
  return `
    <div class="standing-row">
      <span class="team-cell team-link" role="button" tabindex="0" data-team="${escapeHtml(team.name)}" aria-label="Ouvrir la fiche ${escapeHtml(displayTeamName(team.name))}">
        <i class="status-stripe ${escapeHtml(status.key)}"></i>
        ${renderTeamFlag(team.name, "flag-inline")}
        ${escapeHtml(displayTeamName(team.name))}
      </span>
      <span class="standing-numbers">
        <span>${formatOptionalValue(team.played)}</span>
        <span>${formatGoalDifference(team.gd)}</span>
        <span><strong>${formatOptionalValue(team.points)}</strong></span>
        <span class="team-status-text status-${escapeHtml(status.key)}">${escapeHtml(status.label)}</span>
      </span>
    </div>
  `;
}

function getTeamQualificationStatus(group, team, currentBestThirdKeys, allGroupsComplete) {
  const rank = Number(team.rank);
  let key = "eliminated";

  if (rank <= 2) {
    key = "qualified";
  } else if (rank === 3 && currentBestThirdKeys.has(getBestThirdKey(group.name, team.name))) {
    key = "best-third";
  }

  const canChange = canTeamQualificationStatusChange(group, team, key, currentBestThirdKeys, allGroupsComplete);
  const label = groupStatusLabels[key] ?? key;

  return {
    key,
    label: canChange ? `(${label})` : label,
  };
}

function canTeamQualificationStatusChange(group, team, statusKey, currentBestThirdKeys, allGroupsComplete) {
  if (statusKey === "qualified") {
    return !isGuaranteedGroupTopTwo(group, team);
  }

  if (statusKey === "best-third") {
    if (allGroupsComplete) return false;
    return !isGuaranteedBestThird(group, team, currentBestThirdKeys);
  }

  return !isDefinitelyEliminated(group, team, currentBestThirdKeys);
}

function isGuaranteedGroupTopTwo(group, team) {
  const rank = Number(team.rank);
  if (getGroupPhase(group).key === "complete") return rank <= 2;

  const teamKey = normalizeTeamName(displayTeamName(team.name));
  return getGroupPointScenarios(group).every((scenario) => {
    const teamPoints = scenario.get(teamKey);
    if (!isNumber(teamPoints)) return false;
    const teamsAtLeastLevel = [...scenario.values()].filter((points) => points >= teamPoints).length;
    return teamsAtLeastLevel <= 2;
  });
}

function canFinishGroupTopTwo(group, team) {
  const rank = Number(team.rank);
  if (getGroupPhase(group).key === "complete") return rank <= 2;

  const teamKey = normalizeTeamName(displayTeamName(team.name));
  return getGroupPointScenarios(group).some((scenario) => {
    const teamPoints = scenario.get(teamKey);
    if (!isNumber(teamPoints)) return false;
    const teamsAbove = [...scenario.values()].filter((points) => points > teamPoints).length;
    return teamsAbove < 2;
  });
}

function isDefinitelyEliminated(group, team, currentBestThirdKeys) {
  const rank = Number(team.rank);
  const groupComplete = getGroupPhase(group).key === "complete";

  if (groupComplete && rank > 3) return true;
  if (canFinishGroupTopTwo(group, team)) return false;

  return !canStillReachBestThird(group, team, currentBestThirdKeys);
}

function isGuaranteedBestThird(group, team, currentBestThirdKeys) {
  if (!currentBestThirdKeys.has(getBestThirdKey(group.name, team.name))) return false;
  const candidate = getBestThirdCandidateProfile(group, team, "min");
  if (!candidate) return false;

  const possibleThreats = state.standings.filter((otherGroup) => {
    if (normalizeGroupName(otherGroup.name) === normalizeGroupName(group.name)) return false;
    const best = getGroupThirdPointRange(otherGroup).max;
    return best >= candidate.points;
  }).length;

  return possibleThreats < bestThirdQualifyingCount;
}

function canStillReachBestThird(group, team, currentBestThirdKeys) {
  if (currentBestThirdKeys.has(getBestThirdKey(group.name, team.name))) return true;

  const candidate = getBestThirdCandidateProfile(group, team, "max");
  if (!candidate) return false;

  const guaranteedBetterThirds = state.standings.filter((otherGroup) => {
    if (normalizeGroupName(otherGroup.name) === normalizeGroupName(group.name)) return false;
    const worst = getGroupThirdPointRange(otherGroup).min;
    return worst > candidate.points;
  }).length;

  return guaranteedBetterThirds < bestThirdQualifyingCount;
}

function getBestThirdCandidateProfile(group, team, mode) {
  const teamKey = normalizeTeamName(displayTeamName(team.name));
  const scenarios = getGroupPointScenarios(group)
    .map((scenario) => getPossibleThirdProfileFromScenario(scenario, teamKey))
    .filter(Boolean);

  if (!scenarios.length) return null;
  return scenarios.sort((left, right) => mode === "max" ? right.points - left.points : left.points - right.points)[0];
}

function getPossibleThirdProfileFromScenario(scenario, teamKey) {
  const teamPoints = scenario.get(teamKey);
  if (!isNumber(teamPoints)) return null;

  const teamsAbove = [...scenario.entries()].filter(([key, points]) => key !== teamKey && points > teamPoints).length;
  const teamsAtLeastLevel = [...scenario.entries()].filter(([, points]) => points >= teamPoints).length;

  if (teamsAbove > 2 || teamsAtLeastLevel < 3) return null;
  return { points: teamPoints };
}

function getGroupThirdPointRange(group) {
  const thirdPoints = getGroupPointScenarios(group)
    .map((scenario) => [...scenario.values()].sort((left, right) => right - left)[2])
    .filter(isNumber);

  return {
    min: thirdPoints.length ? Math.min(...thirdPoints) : -Infinity,
    max: thirdPoints.length ? Math.max(...thirdPoints) : -Infinity,
  };
}

function getGroupPointScenarios(group) {
  const base = new Map(
    (group?.teams ?? []).map((team) => [
      normalizeTeamName(displayTeamName(team.name)),
      Number(team.points ?? 0),
    ])
  );
  const remainingMatches = getMatchesForGroup(group).filter((match) => match.status !== "finished");
  if (!remainingMatches.length) return [base];

  return remainingMatches.reduce((scenarios, match) => {
    const homeKey = normalizeTeamName(displayTeamName(match.home));
    const awayKey = normalizeTeamName(displayTeamName(match.away));
    if (!base.has(homeKey) || !base.has(awayKey)) return scenarios;

    return scenarios.flatMap((scenario) => [
      addScenarioPoints(scenario, homeKey, 3, awayKey, 0),
      addScenarioPoints(scenario, homeKey, 1, awayKey, 1),
      addScenarioPoints(scenario, homeKey, 0, awayKey, 3),
    ]);
  }, [base]);
}

function addScenarioPoints(scenario, homeKey, homePoints, awayKey, awayPoints) {
  const next = new Map(scenario);
  next.set(homeKey, (next.get(homeKey) ?? 0) + homePoints);
  next.set(awayKey, (next.get(awayKey) ?? 0) + awayPoints);
  return next;
}

function renderBestThirdBoard(currentBestThirdKeys, allGroupsComplete) {
  const rows = getThirdPlacedTeams();

  if (!rows.length) {
    return `<div class="empty-state">Aucun meilleur 3e disponible.</div>`;
  }

  return `
    <article class="leader-card best-third-card">
      <header>
        <h3>Classement des meilleurs 3e</h3>
      </header>
      <div class="standings-table">
        <div class="standing-row is-head">
          <span class="team-cell">Équipe</span>
          <span class="standing-numbers"><span>J</span><span>Diff</span><span>Pts</span><span>Statut</span></span>
        </div>
        ${rows.map((row, index) => {
          const status = getTeamQualificationStatus(
            row.group,
            row.team,
            currentBestThirdKeys,
            allGroupsComplete
          );
          return `
          <div class="standing-row">
            <span class="team-cell team-link" role="button" tabindex="0" data-team="${escapeHtml(row.team.name)}" aria-label="Ouvrir la fiche ${escapeHtml(displayTeamName(row.team.name))}">
              <i class="status-stripe ${escapeHtml(status.key)}"></i>
              ${renderTeamFlag(row.team.name, "flag-inline")}
              <span>
                ${escapeHtml(displayTeamName(row.team.name))}
                <small class="muted">${escapeHtml(row.groupName)} • ${escapeHtml(row.phase.label)}</small>
              </span>
            </span>
            <span class="standing-numbers">
              <span>${formatOptionalValue(row.team.played)}</span>
              <span>${formatGoalDifference(row.team.gd)}</span>
              <span><strong>${formatOptionalValue(row.team.points)}</strong></span>
              <span class="team-status-text status-${escapeHtml(status.key || "unknown")}">${escapeHtml(status.label)}</span>
            </span>
          </div>
        `;
        }).join("")}
      </div>
    </article>
  `;
}

function renderPlayerBoard(title, rows = [], key, label) {
  const filledRows = Array.isArray(rows)
    ? rows.filter((player) => player.name && player.team && player[key] !== undefined)
    : [];

  return filledRows.length ? `
    <article class="leader-card">
      <header><h3>${title}</h3></header>
      <div class="leader-list">
        ${filledRows.map((player, index) => `
          <div class="player-row leader-player${isTeamEliminated(player.team) ? " is-eliminated" : ""}">
            <span class="leader-name"><strong>${index + 1}.</strong> ${renderTeamFlag(player.team, "flag-inline")} <strong>${escapeHtml(player.name)}</strong> <small class="muted">${escapeHtml(player.team)}</small></span>
            <span class="rating">${formatLeaderValue(player[key])} ${label}</span>
          </div>
        `).join("")}
      </div>
    </article>
  ` : `<div class="empty-state">Aucune donnée disponible.</div>`;
}

function renderStandingViews() {
  document.querySelectorAll(".standing-view-tab").forEach((button) => {
    const isActive = button.dataset.standingsView === state.activeStandingView;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  document.querySelectorAll(".standing-view").forEach((view) => {
    view.classList.toggle("is-active", view.dataset.standingView === state.activeStandingView);
  });
}

function getCurrentBestThirdKeySet() {
  return new Set(
    getThirdPlacedTeams()
      .slice(0, bestThirdQualifyingCount)
      .map((row) => getBestThirdKey(row.groupName, row.team.name))
  );
}

function getThirdPlacedTeams() {
  return state.standings
    .map((group) => {
      const teams = Array.isArray(group.teams) ? group.teams : [];
      const team = teams.find((row) => Number(row.rank) === 3);
      return team ? { group, groupName: group.name ?? "Groupe", phase: getGroupPhase(group), team } : null;
    })
    .filter(Boolean)
    .sort(compareThirdPlacedTeams);
}

function areAllGroupsComplete() {
  return state.standings.length > 0 && state.standings.every((group) => getGroupPhase(group).key === "complete");
}

function compareThirdPlacedTeams(left, right) {
  const points = Number(right.team.points ?? -Infinity) - Number(left.team.points ?? -Infinity);
  if (points) return points;

  const goalDifference = Number(right.team.gd ?? -Infinity) - Number(left.team.gd ?? -Infinity);
  if (goalDifference) return goalDifference;

  const played = Number(left.team.played ?? Infinity) - Number(right.team.played ?? Infinity);
  if (played) return played;

  return String(left.groupName).localeCompare(String(right.groupName), "fr-FR", { numeric: true });
}

function getBestThirdKey(groupName, teamName) {
  return `${normalizeGroupName(groupName)}::${normalizeTeamName(displayTeamName(teamName))}`;
}

function sortGroupsByPhase(groups) {
  return [...groups].sort((left, right) => {
    const leftPhase = getGroupPhase(left);
    const rightPhase = getGroupPhase(right);
    if (leftPhase.order !== rightPhase.order) return leftPhase.order - rightPhase.order;
    return String(left.name ?? "").localeCompare(String(right.name ?? ""), "fr-FR", { numeric: true });
  });
}

function getGroupPhase(group) {
  const groupMatches = getMatchesForGroup(group);
  if (groupMatches.some((match) => match.status === "live")) {
    return { key: "live", label: "En direct", order: 0 };
  }
  if (groupMatches.some((match) => match.status === "upcoming")) {
    return { key: "pending", label: "Matchs restants", order: 1 };
  }
  return { key: "complete", label: "Terminé", order: 2 };
}

function getMatchesForGroup(group) {
  const normalizedGroup = normalizeGroupName(group?.name);
  const groupTeams = new Set(
    (group?.teams ?? []).map((team) => normalizeTeamName(displayTeamName(team.name)))
  );

  return state.matches.filter((match) => {
    if (normalizeGroupName(match.group) === normalizedGroup) return true;
    const home = normalizeTeamName(displayTeamName(match.home));
    const away = normalizeTeamName(displayTeamName(match.away));
    return groupTeams.has(home) && groupTeams.has(away);
  });
}

function normalizeGroupName(groupName) {
  return String(groupName ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr-FR");
}

function isTeamEliminated(teamName) {
  const teamKey = normalizeTeamName(displayTeamName(teamName));
  if (!teamKey) return false;

  const currentBestThirdKeys = getCurrentBestThirdKeySet();
  const allGroupsComplete = areAllGroupsComplete();

  return state.standings.some((group) =>
    (group.teams ?? []).some((team) =>
      normalizeTeamName(displayTeamName(team.name)) === teamKey
        && getTeamQualificationStatus(group, team, currentBestThirdKeys, allGroupsComplete).key === "eliminated"
    )
  );
}

function renderBracketTabs() {
  els.stageTabs.innerHTML = stageOrder.map((stage) => `
    <button
      class="stage-tab${stage === state.activeStage ? " is-active" : ""}"
      type="button"
      data-stage="${stage}"
      role="tab"
      aria-selected="${stage === state.activeStage}"
    >
      ${stageLabels[stage]}
    </button>
  `).join("");

  els.stageTabs.querySelectorAll(".stage-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeStage = button.dataset.stage;
      renderBracketTabs();
      renderBracket();
    });
  });
}

function renderBracket() {
  const board = buildBracketBoard();
  els.bracketStage.innerHTML = `
    <div class="bracket-scroll">
      <div class="bracket-tree" style="width: ${getBracketTreeWidth()}px; height: ${getBracketTreeHeight()}px;">
        <div class="bracket-connectors" aria-hidden="true">
          ${board.connectors.map(renderBracketConnector).join("")}
        </div>
        ${board.stages.map(renderBracketColumn).join("")}
      </div>
    </div>
  `;
  window.requestAnimationFrame(scrollActiveBracketColumn);
}

function scrollActiveBracketColumn() {
  const scroll = els.bracketStage.querySelector(".bracket-scroll");
  const activeColumn = els.bracketStage.querySelector(".bracket-column.is-active");
  if (!scroll || !activeColumn) return;

  const targetLeft = Math.max(0, activeColumn.offsetLeft - 12);
  scroll.scrollTo({ left: targetLeft, behavior: "auto" });
}

function buildBracketBoard() {
  const isCompact = isCompactBracketView();
  const stages = stageOrder.map((stage, stageIndex) => {
    const matches = getOrderedStageMatches(stage).map((match, index) => ({
      match,
      stage,
      stageIndex,
      orderIndex: index,
      row: getBracketStageRow(stage, index, isCompact),
    }));

    return { stage, stageIndex, matches };
  });

  const positions = new Map(
    stages.flatMap((stage) => (
      stage.matches.map((item) => [getBracketMatchNumber(item.match), item])
    )).filter(([matchNumber]) => isNumber(matchNumber))
  );

  return {
    stages,
    connectors: buildBracketConnectors(positions),
  };
}

function isCompactBracketView() {
  return stageOrder.indexOf(state.activeStage) >= stageOrder.indexOf("quarterfinals");
}

function getBracketStageRow(stage, index, isCompact) {
  if (isCompact && compactStageRows[stage]) {
    return compactStageRows[stage](index);
  }

  return stageSlotRows[stage](index);
}

function getOrderedStageMatches(stage) {
  const matches = Array.isArray(state.knockout?.[stage]) ? [...state.knockout[stage]] : [];
  const order = stagePathOrders[stage] ?? [];
  return matches.sort((left, right) => {
    const leftOrder = order.indexOf(getBracketMatchNumber(left));
    const rightOrder = order.indexOf(getBracketMatchNumber(right));
    if (leftOrder !== rightOrder) {
      return (leftOrder < 0 ? Infinity : leftOrder) - (rightOrder < 0 ? Infinity : rightOrder);
    }

    return compareBracketMatches(left, right);
  });
}

function buildBracketConnectors(positions) {
  return [
    ...round16Fixtures.map((fixture) => ({ source: fixture.homeMatch, target: fixture.match })),
    ...round16Fixtures.map((fixture) => ({ source: fixture.awayMatch, target: fixture.match })),
    ...quarterfinalFixtures.map((fixture) => ({ source: fixture.homeMatch, target: fixture.match })),
    ...quarterfinalFixtures.map((fixture) => ({ source: fixture.awayMatch, target: fixture.match })),
    ...semifinalFixtures.map((fixture) => ({ source: fixture.homeMatch, target: fixture.match })),
    ...semifinalFixtures.map((fixture) => ({ source: fixture.awayMatch, target: fixture.match })),
    { source: finalFixture.homeMatch, target: finalFixture.match },
    { source: finalFixture.awayMatch, target: finalFixture.match },
  ].map((connector) => {
    const source = positions.get(connector.source);
    const target = positions.get(connector.target);
    if (!source || !target) return null;
    return {
      ...connector,
      layout: getConnectorLayout(source, target),
      winner: Boolean(getMatchWinnerTeam(source.match)),
    };
  }).filter(Boolean);
}

function getConnectorLayout(source, target) {
  const layout = getBracketLayout();
  const sourceX = source.stageIndex * (layout.stageWidth + layout.stageGap)
    + layout.stageWidth;
  const targetX = target.stageIndex * (layout.stageWidth + layout.stageGap);
  const sourceY = getMatchCenterY(source.row);
  const targetY = getMatchCenterY(target.row);
  const left = sourceX;
  const width = Math.max(0, targetX - sourceX);
  const top = Math.min(sourceY, targetY);
  const height = Math.abs(targetY - sourceY);
  const midX = width / 2;

  return {
    left,
    top,
    width,
    height,
    midX,
    sourceY: sourceY - top,
    targetY: targetY - top,
  };
}

function getMatchCenterY(row) {
  const layout = getBracketLayout();
  return ((row - 1) * layout.slotHeight) + (layout.cardHeight / 2);
}

function getBracketTreeWidth() {
  const layout = getBracketLayout();
  return (stageOrder.length * layout.stageWidth)
    + ((stageOrder.length - 1) * layout.stageGap);
}

function getBracketTreeHeight() {
  const layout = getBracketLayout();
  const rows = isCompactBracketView() ? 8 : 32;
  return (rows * layout.slotHeight) + layout.cardHeight;
}

function getBracketLayout() {
  const stageWidth = getBracketStageWidth();
  return { ...bracketLayout, stageWidth };
}

function getBracketStageWidth() {
  const bracketWidth = els.bracketStage?.getBoundingClientRect().width ?? 0;
  const viewportWidth = bracketWidth || Math.min(window.innerWidth || bracketLayout.maxViewportWidth, bracketLayout.maxViewportWidth);
  return Math.max(bracketLayout.minStageWidth, Math.round(viewportWidth - bracketLayout.sidePeek));
}

function renderBracketColumn(stage) {
  const layout = getBracketLayout();
  return `
    <section
      class="bracket-column${stage.stage === state.activeStage ? " is-active" : ""}"
      style="left: ${stage.stageIndex * (layout.stageWidth + layout.stageGap)}px; width: ${layout.stageWidth}px;"
      aria-label="${escapeHtml(stageLabels[stage.stage])}"
    >
      <h3>${escapeHtml(stageLabels[stage.stage])}</h3>
      ${stage.matches.map(renderBracketMatch).join("")}
    </section>
  `;
}

function renderBracketMatch(item) {
  const match = item.match;
  const winner = getMatchWinnerTeam(match);
  const layout = getBracketLayout();
  return `
    <article
      class="bracket-match${match.projected ? " is-projected" : ""}"
      data-stage="${escapeHtml(item.stage)}"
      data-match-id="${escapeHtml(match.id ?? "")}"
      data-match-number="${escapeHtml(getBracketMatchNumber(match) ?? "")}"
      style="top: ${(item.row - 1) * layout.slotHeight}px; height: ${layout.cardHeight}px;"
    >
      <div class="bracket-meta">
        <span>${escapeHtml(formatStageSlot(item.stage, item.orderIndex))}</span>
        <span>${renderBracketStatus(match)}</span>
      </div>
      ${renderBracketTeamRow(match, "home", winner)}
      ${renderBracketTeamRow(match, "away", winner)}
    </article>
  `;
}

function renderBracketTeamRow(match, side, winner) {
  const team = match[side];
  const options = match[`${side}Options`];
  const score = formatBracketScore(match[`${side}Score`]);
  const isWinner = winner && sameTeam(winner, team);
  const isLockedSlot = isTeamLockedInBracketSlot(match, side);
  return `
    <div class="bracket-row${isWinner ? " is-winner" : ""}">
      <span class="bracket-team">${renderBracketTeam(team, options, isLockedSlot)}</span>
      ${score ? `<span class="bracket-score">${escapeHtml(score)}</span>` : ""}
    </div>
  `;
}

function renderBracketStatus(match) {
  if (match.projected) return "Incertain";
  return renderInlineMeta([statusLabels[match.status] ?? "À confirmer", formatDate(match.date)]);
}

function renderBracketConnector(connector) {
  const { layout } = connector;
  return `
    <span
      class="bracket-connector${connector.winner ? " is-winner" : ""}"
      style="left: ${layout.left}px; top: ${layout.top}px; width: ${layout.width}px; height: ${layout.height}px;"
    >
      <span class="connector-line connector-line-start" style="top: ${layout.sourceY}px; width: ${layout.midX}px;"></span>
      <span class="connector-line connector-line-vertical" style="left: ${layout.midX}px; top: 0; height: ${layout.height}px;"></span>
      <span class="connector-line connector-line-end" style="left: ${layout.midX}px; top: ${layout.targetY}px; width: ${layout.midX}px;"></span>
    </span>
  `;
}

function renderBracketTeam(team, options, isLockedSlot = false) {
  if (Array.isArray(options) && options.length) {
    return `
      <span class="bracket-team-options" aria-label="${escapeHtml(formatTeamOptionsLabel(options))}">
        ${options.map((option, index) => `
          ${index ? `<span class="bracket-option-separator">/</span>` : ""}
          <span class="bracket-team-option team-link" role="button" tabindex="0" data-team="${escapeHtml(option)}" aria-label="Ouvrir la fiche ${escapeHtml(displayTeamName(option))}">
            ${renderTeamFlag(option, "flag-bracket")}
          </span>
        `).join("")}
      </span>
    `;
  }

  const isClickable = isConcreteTeam(team);
  return `
    <span
      class="bracket-team-label${isClickable ? " team-link" : ""}${isLockedSlot ? " is-locked-slot" : ""}"
      ${isClickable ? `role="button" tabindex="0" data-team="${escapeHtml(team)}" aria-label="Ouvrir la fiche ${escapeHtml(displayTeamName(team))}"` : ""}
    >
      ${renderTeamFlag(team, "flag-bracket")}
      <span>${escapeHtml(displayTeamName(team))}</span>
    </span>
  `;
}

function isTeamLockedInBracketSlot(match, side) {
  const team = match?.[side];
  if (!isConcreteTeam(team)) return false;

  const stage = getKnockoutStageKey(match.stage);
  if (stage === "round32") {
    return isTeamLockedInRound32Slot(match, side);
  }

  if (stage === "semifinals") {
    return isTeamLockedInSingleSemifinal(team);
  }

  return false;
}

function isTeamLockedInRound32Slot(match, side) {
  if (!match.projected) return true;

  const matchNumber = getBracketMatchNumber(match);
  const fixture = round32Fixtures.find((item) => item.match === matchNumber);
  const seed = fixture?.[side];
  if (!seed) return false;

  if (seed.type === "rank") {
    return isGroupComplete(seed.group) && seedMatchesTeam(seed, match[side], state.standings);
  }

  return areAllGroupsComplete() && seedMatchesTeam(seed, match[side], state.standings);
}

function isGroupComplete(groupLetter) {
  const group = getGroupByLetter(state.standings, groupLetter);
  return Boolean(group && getGroupPhase(group).key === "complete");
}

function isTeamLockedInSingleSemifinal(team) {
  if (!isConcreteTeam(team)) return false;
  const semifinalMatches = (state.knockout?.semifinals ?? [])
    .filter((match) => !match.projected && (sameTeam(match.home, team) || sameTeam(match.away, team)))
    .map(getBracketMatchNumber)
    .filter(Boolean);
  return new Set(semifinalMatches).size === 1;
}

function formatTeamOptionsLabel(options) {
  return options.map(displayTeamName).join(" ou ");
}

function moveStage(direction) {
  const index = stageOrder.indexOf(state.activeStage);
  const next = Math.max(0, Math.min(stageOrder.length - 1, index + direction));
  state.activeStage = stageOrder[next];
  renderBracketTabs();
  renderBracket();
}

function handleStageSwipe(distance) {
  if (Math.abs(distance) > 48) {
    moveStage(distance < 0 ? 1 : -1);
  }
}

function setActiveTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `panel-${tab}`);
  });

  if (tab === "matches") {
    window.requestAnimationFrame(scrollMatchesToUpcoming);
    return;
  }

  window.requestAnimationFrame(scrollPageToTop);
}

function scrollPageToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  document.querySelector(`#panel-${state.activeTab}`)?.scrollIntoView({ block: "start" });
}

function scheduleRefresh() {
  window.clearTimeout(state.refreshTimer);
  const hasLiveMatch = state.matches.some((match) => match.status === "live");
  const interval = hasLiveMatch ? 30000 : 180000;

  state.refreshTimer = window.setTimeout(async () => {
    await refreshData();
    scheduleRefresh();
  }, interval);
}

async function refreshData() {
  try {
    await loadData();
    if (!getSelectedMatch()) selectDefaultMatch();
    renderAll();
  } catch (error) {
    console.warn("Synchronisation locale impossible", error);
    updateRefreshPill();
  }
}

function updateRefreshPill() {
  if (!els.refreshPill) return;
  const hasLiveMatch = state.matches.some((match) => match.status === "live");
  const cadence = hasLiveMatch ? "30 s en live" : "3 min";
  const time = state.lastRefresh
    ? state.lastRefresh.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : "--:--";
  els.refreshPill.textContent = `Synchronisation locale • ${cadence} • ${time}`;
}

function getSelectedMatch() {
  return state.matches.find((match) => match.id === state.selectedMatchId);
}

function renderStatus(match) {
  const status = match.status ?? "unknown";
  const live = status === "live" ? `<i class="live-dot"></i>` : "";
  const minute = status === "live" && match.minute ? ` • ${match.minute}'` : "";
  return `<span class="status-badge status-${escapeHtml(status)}">${live}${statusLabels[status] ?? "Statut non renseigné"}${minute}</span>`;
}

function scoreText(match) {
  if (!hasMatchScore(match)) return "À venir";
  return `${match.score.home}-${match.score.away}`;
}

function hasMatchScore(match) {
  return isNumber(match.score?.home) && isNumber(match.score?.away);
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function formatDate(value) {
  if (!value) return "Date à confirmer";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderTeamSub(value) {
  return value ? `<span class="team-sub">${escapeHtml(value)}</span>` : "";
}

function renderInlineMeta(parts) {
  return parts.filter(Boolean).map(escapeHtml).join(" • ");
}

function formatLeaderValue(value) {
  return typeof value === "number" && !Number.isInteger(value) ? value.toFixed(2) : value;
}

function formatOptionalValue(value) {
  return value ?? "—";
}

function formatGoalDifference(value) {
  if (!isNumber(value)) return "—";
  return `${value > 0 ? "+" : ""}${value}`;
}

function formatBracketScore(value) {
  return isNumber(value) ? String(value) : "";
}

function getMatchWinnerTeam(match) {
  const homeScore = match?.homeScore ?? match?.score?.home;
  const awayScore = match?.awayScore ?? match?.score?.away;
  if (!isNumber(homeScore) || !isNumber(awayScore) || homeScore === awayScore) return null;
  return homeScore > awayScore ? match.home : match.away;
}

function displayTeamName(team) {
  const value = String(team ?? "").trim();
  if (!value || value.toLocaleLowerCase("fr-FR") === "null") return "Équipe à confirmer";
  return teamNameFr[value] ?? value;
}

function isConcreteTeam(team) {
  const label = displayTeamName(team);
  if (!label || label === "Équipe à confirmer") return false;
  return !/^vainqueur\b/iu.test(label) && !/groupe\s+[A-L]/iu.test(label);
}

function findCanonicalTeamName(team) {
  const label = displayTeamName(team);
  const standing = findStandingTeam(label);
  if (standing) return standing.team.name;

  const matchTeam = state.matches.flatMap((match) => [match.home, match.away])
    .find((candidate) => sameTeam(candidate, label));
  return matchTeam ?? label;
}

function findStandingTeam(team) {
  const teamKey = normalizeTeamName(displayTeamName(team));
  if (!teamKey) return null;

  for (const group of state.standings) {
    const row = (group.teams ?? []).find((candidate) =>
      normalizeTeamName(displayTeamName(candidate.name)) === teamKey
    );
    if (row) return { group, team: row };
  }

  return null;
}

function renderTeamFlag(team, className = "") {
  const label = displayTeamName(team);
  const code = teamFlags[normalizeTeamName(label)];
  if (!code) return "";
  const classes = ["team-flag", className].filter(Boolean).join(" ");
  const url = `https://flagcdn.com/${encodeURIComponent(code)}.svg`;
  return `
    <span class="${escapeHtml(classes)}" aria-label="Drapeau ${escapeHtml(label)}">
      <img src="${url}" alt="" loading="lazy" decoding="async" />
    </span>
  `;
}

function sameTeam(left, right) {
  return normalizeTeamName(displayTeamName(left)) === normalizeTeamName(displayTeamName(right));
}

function renderError(error) {
  const message = escapeHtml(error.message ?? "Erreur de chargement.");
  if (els.matchesList) {
    els.matchesList.innerHTML = `<div class="empty-state">${message}</div>`;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
