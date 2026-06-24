const state = {
  matches: [],
  standings: [],
  players: {},
  odds: {},
  selectedMatchId: null,
  activeTab: "matches",
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
  els.groupsGrid = document.querySelector("#groupsGrid");
  els.standingsLegend = document.querySelector("#standingsLegend");
  els.playersBoards = document.querySelector("#playersBoards");
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
  const finished = [...state.matches]
    .filter((match) => match.status === "finished")
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  state.selectedMatchId = (live ?? finished ?? state.matches[0])?.id ?? null;
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

  els.matchesList.innerHTML = state.matches.map(renderMatchCard).join("");
  els.matchesList.querySelectorAll(".match-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedMatchId = card.dataset.matchId;
      renderMatches();
      els.matchDetail.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderMatchCard(match) {
  const isSelected = match.id === state.selectedMatchId ? " is-selected" : "";
  return `
    <button class="match-card${isSelected}" type="button" data-match-id="${escapeHtml(match.id)}">
      <span class="match-meta">
        <span>${renderInlineMeta([match.stage, formatDate(match.date)])}</span>
        ${renderStatus(match)}
      </span>
      <span class="match-line">
        <span class="team-name">${escapeHtml(match.home ?? "Équipe à confirmer")}</span>
        <span class="compact-score">${scoreText(match)}</span>
        <span class="team-name">${escapeHtml(match.away ?? "Équipe à confirmer")}</span>
      </span>
    </button>
  `;
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
            <span class="team-name">${escapeHtml(match.home ?? "Équipe à confirmer")}</span>
            ${renderTeamSub(match.homeCoach)}
            ${renderTeamScorers(match, "home")}
          </div>
          <div class="score">${scoreText(match)}</div>
          <div class="team away">
            <span class="team-name">${escapeHtml(match.away ?? "Équipe à confirmer")}</span>
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
    ${renderLineups(match.probableLineups, "Compositions probables")}
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
    .normalize("NFKC")
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
    return `
      <div class="lineup-block">
        ${lineup.team ? `<strong>${escapeHtml(lineup.team)}</strong>` : ""}
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
    [match.home ?? "Domicile", match.winProbability?.home],
    ["Nul", match.winProbability?.draw],
    [match.away ?? "Extérieur", match.winProbability?.away],
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
  const odds = Array.isArray(state.odds[match.id]) ? state.odds[match.id] : [];
  const rows = odds.filter((book) =>
    book.bookmaker && isNumber(book.home) && isNumber(book.draw) && isNumber(book.away)
  );

  if (!rows.length) {
    return `<p class="muted">Cotes bientôt disponibles</p>`;
  }
  return rows.map((book) => `
    <div class="odds-row">
      <strong>${escapeHtml(book.bookmaker)}</strong>
      <span>${escapeHtml(match.home ?? "Domicile")} ${book.home.toFixed(2)}</span>
      <span>Nul ${book.draw.toFixed(2)}</span>
      <span>${escapeHtml(match.away ?? "Extérieur")} ${book.away.toFixed(2)}</span>
    </div>
  `).join("");
}

function renderStandings() {
  if (els.standingsLegend) {
    els.standingsLegend.hidden = state.standings.length === 0;
  }

  els.groupsGrid.innerHTML = state.standings.length ? state.standings.map((group) => `
    <article class="group-card">
      <header>
        <h3>${escapeHtml(group.name ?? "Groupe")}</h3>
      </header>
      <div class="standings-table">
        <div class="standing-row is-head">
          <span class="team-cell">Équipe</span>
          <span class="standing-numbers"><span>J</span><span>Diff</span><span>Pts</span><span>Statut</span></span>
        </div>
        ${(Array.isArray(group.teams) ? group.teams : []).map((team) => `
          <div class="standing-row">
            <span class="team-cell">
              <i class="status-stripe ${escapeHtml(team.status ?? "")}"></i>
              ${escapeHtml(team.name ?? "Équipe non renseignée")}
            </span>
            <span class="standing-numbers">
              <span>${formatOptionalValue(team.played)}</span>
              <span>${formatGoalDifference(team.gd)}</span>
              <span><strong>${formatOptionalValue(team.points)}</strong></span>
              <span>${team.status ? escapeHtml(groupStatusLabels[team.status] ?? team.status) : "—"}</span>
            </span>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("") : `<div class="empty-state">Aucun classement disponible.</div>`;

  const boards = [
    ["Meilleurs buteurs", state.players.topScorers, "goals", "buts"],
    ["Meilleurs passeurs", state.players.topAssists, "assists", "passes"],
    ["Meilleurs joueurs", state.players.topPlayers, "rating", "moy."],
    ["Jeunes joueurs", state.players.youngPlayers, "rating", "moy."],
  ].filter(([, rows]) => Array.isArray(rows) && rows.length);

  const filledBoards = boards.map(([title, rows = [], key, label]) => [
    title,
    rows.filter((player) => player.name && player.team && player[key] !== undefined),
    key,
    label,
  ]).filter(([, rows]) => rows.length);

  els.playersBoards.innerHTML = filledBoards.length ? filledBoards.map(([title, rows, key, label]) => `
    <article class="leader-card">
      <header><h3>${title}</h3></header>
      <div class="leader-list">
        ${rows.map((player, index) => `
          <div class="player-row">
            <span><strong>${index + 1}. ${escapeHtml(player.name)}</strong> <small class="muted">${escapeHtml(player.team)}</small></span>
            <span class="rating">${formatLeaderValue(player[key])} ${label}</span>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("") : `<div class="empty-state">Aucune performance individuelle disponible.</div>`;
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
            <span class="bracket-team">${escapeHtml(match.home ?? "Équipe à confirmer")}</span>
            <span class="bracket-score">${formatBracketScore(match.homeScore)}</span>
          </div>
          <div class="bracket-row">
            <span class="bracket-team">${escapeHtml(match.away ?? "Équipe à confirmer")}</span>
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
