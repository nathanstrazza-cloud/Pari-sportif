const state = {
  matches: [],
  standings: [],
  players: {},
  odds: {},
  selectedMatchId: null,
  selectedTeam: null,
  activeTab: "matches",
  activeStandingView: "groups",
  activeStage: "round32",
  refreshTimer: null,
  touchStartX: 0,
  lastRefresh: null,
};

const stageOrder = ["round32", "round16", "quarterfinals", "semifinals", "final"];
const stageLabels = {
  round32: "16es",
  round16: "8es",
  quarterfinals: "Quarts",
  semifinals: "Demies",
  final: "Finale",
};

const statusLabels = {
  live: "Live",
  finished: "Terminé",
  upcoming: "À venir",
};

const groupStatusLabels = {
  qualified: "Qualifié",
  "best-third": "Meilleur 3e",
  eliminated: "Éliminé",
};

const bestThirdQualifyingCount = 8;

const teamNameFr = {
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
  const [matches, standings, players, odds] = await Promise.all([
    fetchJson("data/matches.json"),
    fetchJson("data/standings.json"),
    fetchJson("data/players-ea.json"),
    fetchJson("data/odds.json"),
  ]);

  state.matches = Array.isArray(matches.matches) ? matches.matches : [];
  state.knockout = matches.knockout && typeof matches.knockout === "object" ? matches.knockout : {};
  state.standings = Array.isArray(standings.groups) ? standings.groups : [];
  state.players = players && typeof players === "object" ? players : {};
  state.odds = odds.markets && typeof odds.markets === "object" ? odds.markets : {};
  state.lastRefresh = new Date();
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Impossible de charger ${path}`);
  }
  return response.json();
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
}

function bindBracket() {
  els.prevStage.addEventListener("click", () => moveStage(-1));
  els.nextStage.addEventListener("click", () => moveStage(1));

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
  const selected = getSelectedMatch();
  els.matchDetail.innerHTML = selected
    ? renderMatchDetail(selected)
    : `<div class="empty-state">Aucun match disponible.</div>`;

  els.matchesList.innerHTML = [
    state.selectedTeam ? renderTeamHistory(state.selectedTeam) : "",
    renderMatchSection("En cours", getMatchesByStatus("live"), "Aucun match en direct."),
    renderMatchSection("À venir", getMatchesByStatus("upcoming"), "Aucun match à venir."),
    renderMatchSection("Terminés", getMatchesByStatus("finished"), "Aucun match terminé."),
  ].filter(Boolean).join("");

  els.matchesList.onclick = handleMatchesListClick;
  els.matchesList.onkeydown = handleMatchesListKeydown;
  els.matchDetail.querySelectorAll("[data-team]").forEach((team) => {
    team.addEventListener("click", (event) => {
      event.stopPropagation();
      selectTeam(team.dataset.team);
    });
  });
}

function renderMatchCard(match) {
  const isSelected = match.id === state.selectedMatchId ? " is-selected" : "";
  return `
    <article class="match-card${isSelected}" role="button" tabindex="0" data-match-id="${escapeHtml(match.id)}">
      <span class="match-meta">
        <span>${renderInlineMeta([match.stage, formatDate(match.date)])}</span>
        ${renderStatus(match)}
      </span>
      <span class="match-line">
        ${renderMatchTeam(match.home, "home")}
        <span class="compact-score">${scoreText(match)}</span>
        ${renderMatchTeam(match.away, "away")}
      </span>
    </article>
  `;
}

function renderMatchTeam(team, side = "") {
  return `
    <span class="match-team match-team-${escapeHtml(side)} team-link" role="button" tabindex="0" data-team="${escapeHtml(team ?? "")}">
      ${renderTeamFlag(team, "flag-match")}
      <span class="team-name">${escapeHtml(displayTeamName(team))}</span>
    </span>
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

function handleMatchesListClick(event) {
  const team = event.target.closest("[data-team]");
  if (team) {
    event.preventDefault();
    event.stopPropagation();
    selectTeam(team.dataset.team);
    return;
  }

  const clearTeam = event.target.closest("[data-clear-team]");
  if (clearTeam) {
    state.selectedTeam = null;
    renderMatches();
    return;
  }

  const card = event.target.closest(".match-card");
  if (!card) return;

  state.selectedMatchId = card.dataset.matchId;
  renderMatches();
  els.matchDetail.scrollIntoView({ behavior: "smooth", block: "start" });
}

function handleMatchesListKeydown(event) {
  if (!["Enter", " "].includes(event.key)) return;
  const target = event.target.closest("[data-team], [data-clear-team], .match-card, .team-match-row");
  if (!target) return;
  event.preventDefault();
  target.click();
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

function renderMatchDetail(match) {
  const isUpcoming = match.status === "upcoming";
  return `
    <article>
      <div class="detail-hero">
        <div class="match-meta">
          <span>${renderInlineMeta([match.stage, match.venue, formatDate(match.date)])}</span>
          ${renderStatus(match)}
        </div>
        <div class="score-row">
          <div class="team">
            ${renderTeamFlag(match.home, "flag-detail")}
            <span class="team-name team-link" role="button" tabindex="0" data-team="${escapeHtml(match.home ?? "")}">${escapeHtml(displayTeamName(match.home))}</span>
            ${renderTeamSub(match.homeCoach)}
            ${renderTeamScorers(match, "home")}
          </div>
          <div class="score">${scoreText(match)}</div>
          <div class="team away">
            ${renderTeamFlag(match.away, "flag-detail")}
            <span class="team-name team-link" role="button" tabindex="0" data-team="${escapeHtml(match.away ?? "")}">${escapeHtml(displayTeamName(match.away))}</span>
            ${renderTeamSub(match.awayCoach)}
            ${renderTeamScorers(match, "away")}
          </div>
        </div>
      </div>
      ${
        isUpcoming
          ? renderUpcomingDetail(match)
          : renderPlayedDetail(match)
      }
    </article>
  `;
}

function renderPlayedDetail(match) {
  return [
    renderLineups(match.lineups, "Compositions"),
    renderStats(match.stats),
    renderRatings(match.playerRatings),
  ].join("");
}

function renderUpcomingDetail(match) {
  return `
    ${renderLineups(match.probableLineups, lineupSectionTitle(match.probableLineups, "Compositions probables"))}
    ${renderWinProbability(match)}
    <section class="detail-section">
      <h3>Cotes</h3>
      <div class="odds-table">
        ${renderOdds(match)}
      </div>
    </section>
  `;
}

function renderTeamScorers(match, side) {
  const team = match?.[side];
  const scorers = getTeamScorers(match, side);
  if (!team || !scorers.length) return "";

  return `
    <div class="team-scorers" aria-label="Buteurs ${escapeHtml(team)}">
      ${scorers.map((scorer) => `<span class="team-scorer">${escapeHtml(formatTeamScorer(scorer, team))}</span>`).join("")}
    </div>
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

function renderLineups(lineups, title) {
  const blocks = ["home", "away"].map((side) => {
    const lineup = lineups?.[side];
    const players = Array.isArray(lineup?.players) ? lineup.players.filter(Boolean) : [];
    if (!lineup || !players.length) return "";

    const details = [lineup.formation, players.join(", ")].filter(Boolean).join(" • ");
    const source = formatLineupSource(lineup);
    return `
      <div class="lineup-block">
        ${lineup.team ? `<strong>${escapeHtml(displayTeamName(lineup.team))}</strong>` : ""}
        ${source ? `<small class="lineup-source">${escapeHtml(source)}</small>` : ""}
        ${details ? `<p>${escapeHtml(details)}</p>` : ""}
      </div>
    `;
  }).filter(Boolean);

  return `
    <section class="detail-section">
      <h3>${title}</h3>
      ${
        blocks.length
          ? `<div class="lineups">${blocks.join("")}</div>`
          : `<p class="muted">Compositions non disponibles pour le moment</p>`
      }
    </section>
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

function renderStats(stats) {
  if (!stats) return "";
  const rows = [
    ["Possession", stats.possession?.home, stats.possession?.away, "%"],
    ["Tirs", stats.shots?.home, stats.shots?.away, ""],
    ["Tirs cadrés", stats.shotsOnTarget?.home, stats.shotsOnTarget?.away, ""],
    ["Corners", stats.corners?.home, stats.corners?.away, ""],
    ["Fautes", stats.fouls?.home, stats.fouls?.away, ""],
  ].filter(([, home, away]) => isNumber(home) && isNumber(away));

  if (!rows.length) return "";

  return `
    <section class="detail-section">
      <h3>Stats</h3>
      <div class="stats-grid">
        ${rows.map(([label, home, away, suffix]) => {
          const total = Number(home) + Number(away);
          const homeValue = total > 0 ? Math.round((Number(home) / total) * 100) : 0;
          const awayValue = total > 0 ? Math.round((Number(away) / total) * 100) : 0;
          return `
            <div class="stat-line">
              <span>${home}${suffix}</span>
              <div class="bar" style="--value: ${homeValue}%"><i></i></div>
              <b>${label}</b>
              <div class="bar away" style="--value: ${awayValue}%"><i></i></div>
              <span>${away}${suffix}</span>
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderRatings(ratings) {
  if (!ratings) return "";
  const columns = ["home", "away"].map((side) => {
    const rows = Array.isArray(ratings[side]) ? ratings[side] : [];
    return rows.filter((player) => player.name && isNumber(player.rating));
  });

  if (!columns.some((rows) => rows.length)) return "";

  return `
    <section class="detail-section">
      <h3>Notes joueurs</h3>
      <div class="ratings-grid">
        ${columns.map((rows) => `
          <div>
            ${rows.map((player) => `
              <div class="player-row">
                <span>${escapeHtml(player.name)} ${player.role ? `<small class="muted">${escapeHtml(player.role)}</small>` : ""}</span>
                <span class="rating">${player.rating.toFixed(1)}</span>
              </div>
            `).join("")}
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderWinProbability(match) {
  const rows = [
    [displayTeamName(match.home), match.winProbability?.home],
    ["Nul", match.winProbability?.draw],
    [displayTeamName(match.away), match.winProbability?.away],
  ].filter(([, value]) => isNumber(value));

  if (!rows.length) return "";

  return `
    <section class="detail-section">
      <h3>Pourcentages de victoire</h3>
      <div class="probability-list">
        ${rows.map(([label, value]) => renderProbability(label, value)).join("")}
      </div>
    </section>
  `;
}

function renderProbability(label, value) {
  return `
    <div class="stat-line">
      <span>${value}%</span>
      <div class="bar" style="--value: ${value}%"><i></i></div>
      <b>${escapeHtml(label)}</b>
    </div>
  `;
}

function renderOdds(match) {
  const apiFootballId = match.externalIds?.apiFootball ?? match.apiFootballFixtureId;
  const odds = [match.id, apiFootballId]
    .map((id) => state.odds[id])
    .find((rows) => Array.isArray(rows)) ?? [];
  const rows = odds.filter((book) =>
    book.bookmaker && isNumber(book.home) && isNumber(book.draw) && isNumber(book.away)
  );

  if (!rows.length) {
    return `<p class="muted">Cotes bientôt disponibles</p>`;
  }
  return rows.map((book) => `
    <div class="odds-row">
      <strong>${escapeHtml(book.bookmaker)}</strong>
      <span>${escapeHtml(displayTeamName(match.home))} ${book.home.toFixed(2)}</span>
      <span>Nul ${book.draw.toFixed(2)}</span>
      <span>${escapeHtml(displayTeamName(match.away))} ${book.away.toFixed(2)}</span>
    </div>
  `).join("");
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
      <span class="team-cell">
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
            <span class="team-cell">
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
  const stageMatches = state.knockout?.[state.activeStage];
  const matches = Array.isArray(stageMatches) ? stageMatches : [];
  els.bracketStage.innerHTML = `
    <div class="bracket-list">
      ${matches.length ? matches.map((match) => `
        <article class="bracket-match">
          <div class="bracket-meta">
            <span>${escapeHtml(match.slot ?? "")}</span>
            <span>${escapeHtml(formatDate(match.date))}</span>
          </div>
          <div class="bracket-row">
            <span class="bracket-team">${escapeHtml(displayTeamName(match.home))}</span>
            <span class="bracket-score">${formatBracketScore(match.homeScore)}</span>
          </div>
          <div class="bracket-row">
            <span class="bracket-team">${escapeHtml(displayTeamName(match.away))}</span>
            <span class="bracket-score">${formatBracketScore(match.awayScore)}</span>
          </div>
        </article>
      `).join("") : `<div class="empty-state">Aucun match disponible pour ce tour.</div>`}
    </div>
  `;
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
  return isNumber(value) ? value : "À venir";
}

function displayTeamName(team) {
  const value = String(team ?? "").trim();
  if (!value || value.toLocaleLowerCase("fr-FR") === "null") return "Équipe à confirmer";
  return teamNameFr[value] ?? value;
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
  els.matchDetail.innerHTML = `<div class="empty-state">${message}</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
