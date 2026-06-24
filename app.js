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

  state.matches = matches.matches ?? [];
  state.knockout = matches.knockout ?? {};
  state.standings = standings.groups ?? [];
  state.players = players;
  state.odds = odds.markets ?? {};
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
        <span>${escapeHtml(match.stage)} • ${formatDate(match.date)}</span>
        ${renderStatus(match)}
      </span>
      <span class="match-line">
        <span class="team-name">${escapeHtml(match.home)}</span>
        <span class="compact-score">${scoreText(match)}</span>
        <span class="team-name">${escapeHtml(match.away)}</span>
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
          <span>${escapeHtml(match.stage)} • ${escapeHtml(match.venue)} • ${formatDate(match.date)}</span>
          ${renderStatus(match)}
        </div>
        <div class="score-row">
          <div class="team">
            <span class="team-name">${escapeHtml(match.home)}</span>
            <span class="team-sub">${escapeHtml(match.homeCoach ?? "Sélection nationale")}</span>
          </div>
          <div class="score">${scoreText(match)}</div>
          <div class="team away">
            <span class="team-name">${escapeHtml(match.away)}</span>
            <span class="team-sub">${escapeHtml(match.awayCoach ?? "Sélection nationale")}</span>
          </div>
        </div>
      </div>
      ${
        isUpcoming
          ? renderUpcomingDetail(match)
          : renderPlayedDetail(match)
      }
      ${renderExpertChat(match)}
    </article>
  `;
}

function renderPlayedDetail(match) {
  return `
    <section class="detail-section">
      <h3>Buteurs</h3>
      <div class="chips">
        ${(match.scorers ?? []).map((scorer) => `<span class="chip">${escapeHtml(scorer)}</span>`).join("") || `<p class="muted">Aucun but renseigné.</p>`}
      </div>
    </section>
    <section class="detail-section">
      <h3>Temps forts</h3>
      <div class="highlights">
        ${(match.highlights ?? []).map((item) => `<p class="highlight"><strong>${escapeHtml(item.minute)}</strong>${escapeHtml(item.text)}</p>`).join("")}
      </div>
    </section>
    ${renderLineups(match.lineups, "Compositions")}
    ${renderStats(match.stats)}
    ${renderRatings(match.playerRatings)}
  `;
}

function renderUpcomingDetail(match) {
  return `
    ${renderLineups(match.probableLineups, "Compositions probables")}
    <section class="detail-section">
      <h3>Pourcentages de victoire</h3>
      <div class="probability-list">
        ${renderProbability(match.home, match.winProbability?.home ?? 0, "blue")}
        ${renderProbability("Nul", match.winProbability?.draw ?? 0, "gold")}
        ${renderProbability(match.away, match.winProbability?.away ?? 0, "blue")}
      </div>
    </section>
    <section class="detail-section">
      <h3>Cotes</h3>
      <div class="odds-table">
        ${renderOdds(match)}
      </div>
    </section>
  `;
}

function renderLineups(lineups, title) {
  if (!lineups) return "";
  return `
    <section class="detail-section">
      <h3>${title}</h3>
      <div class="lineups">
        ${["home", "away"].map((side) => {
          const lineup = lineups[side];
          if (!lineup) return "";
          return `
            <div class="lineup-block">
              <strong>${escapeHtml(lineup.team)}</strong>
              <p>${escapeHtml(lineup.formation)} • ${escapeHtml(lineup.players.join(", "))}</p>
            </div>
          `;
        }).join("")}
      </div>
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
  ];

  return `
    <section class="detail-section">
      <h3>Stats</h3>
      <div class="stats-grid">
        ${rows.map(([label, home, away, suffix]) => {
          const total = Number(home) + Number(away) || 1;
          const homeValue = Math.round((Number(home) / total) * 100);
          const awayValue = Math.round((Number(away) / total) * 100);
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
  return `
    <section class="detail-section">
      <h3>Notes joueurs</h3>
      <div class="ratings-grid">
        ${["home", "away"].map((side) => `
          <div>
            ${(ratings[side] ?? []).map((player) => `
              <div class="player-row">
                <span>${escapeHtml(player.name)} <small class="muted">${escapeHtml(player.role)}</small></span>
                <span class="rating">${player.rating.toFixed(1)}</span>
              </div>
            `).join("")}
          </div>
        `).join("")}
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
  const odds = state.odds[match.id] ?? [];
  if (!odds.length) {
    return `<p class="muted">Cotes à confirmer.</p>`;
  }
  return odds.map((book) => `
    <div class="odds-row">
      <strong>${escapeHtml(book.bookmaker)}</strong>
      <span>${escapeHtml(match.home)} ${book.home.toFixed(2)}</span>
      <span>Nul ${book.draw.toFixed(2)}</span>
      <span>${escapeHtml(match.away)} ${book.away.toFixed(2)}</span>
    </div>
  `).join("");
}

function renderExpertChat(match) {
  const messages = match.expertDiscussion ?? [];
  return `
    <section class="detail-section">
      <h3>Discussion IA simulée</h3>
      <div class="expert-chat">
        ${messages.slice(0, 5).map((message) => `
          <p class="expert-message">
            <strong>${escapeHtml(message.expert)}</strong>
            ${escapeHtml(message.text)}
          </p>
        `).join("")}
      </div>
    </section>
  `;
}

function renderStandings() {
  els.groupsGrid.innerHTML = state.standings.map((group) => `
    <article class="group-card">
      <header>
        <h3>${escapeHtml(group.name)}</h3>
      </header>
      <div class="standings-table">
        <div class="standing-row is-head">
          <span class="team-cell">Équipe</span>
          <span class="standing-numbers"><span>J</span><span>Diff</span><span>Pts</span><span>Statut</span></span>
        </div>
        ${group.teams.map((team) => `
          <div class="standing-row">
            <span class="team-cell">
              <i class="status-stripe ${team.status}"></i>
              ${escapeHtml(team.name)}
            </span>
            <span class="standing-numbers">
              <span>${team.played}</span>
              <span>${team.gd > 0 ? "+" : ""}${team.gd}</span>
              <span><strong>${team.points}</strong></span>
              <span>${escapeHtml(groupStatusLabels[team.status] ?? team.status)}</span>
            </span>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("");

  const boards = [
    ["Meilleurs buteurs", state.players.topScorers, "goals", "buts"],
    ["Meilleurs passeurs", state.players.topAssists, "assists", "passes"],
    ["Meilleurs joueurs", state.players.topPlayers, "rating", "moy."],
    ["Jeunes joueurs", state.players.youngPlayers, "rating", "moy."],
  ];

  els.playersBoards.innerHTML = boards.map(([title, rows = [], key, label]) => `
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
  `).join("");
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
  const matches = state.knockout?.[state.activeStage] ?? [];
  els.bracketStage.innerHTML = `
    <div class="bracket-list">
      ${matches.map((match) => `
        <article class="bracket-match">
          <div class="bracket-meta">
            <span>${escapeHtml(match.slot)}</span>
            <span>${formatDate(match.date)}</span>
          </div>
          <div class="bracket-row">
            <span class="bracket-team">${escapeHtml(match.home)}</span>
            <span class="bracket-score">${match.homeScore ?? "-"}</span>
          </div>
          <div class="bracket-row">
            <span class="bracket-team">${escapeHtml(match.away)}</span>
            <span class="bracket-score">${match.awayScore ?? "-"}</span>
          </div>
        </article>
      `).join("")}
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
  const interval = hasLiveMatch ? 8000 : 180000;

  state.refreshTimer = window.setTimeout(() => {
    simulateRefresh();
    scheduleRefresh();
  }, interval);
}

function simulateRefresh() {
  state.lastRefresh = new Date();
  state.matches = state.matches.map((match) => {
    if (match.status !== "live") return match;
    const minute = Math.min((match.minute ?? 0) + 1, 90);
    const shots = {
      home: (match.stats?.shots?.home ?? 0) + (minute % 3 === 0 ? 1 : 0),
      away: (match.stats?.shots?.away ?? 0) + (minute % 4 === 0 ? 1 : 0),
    };
    return {
      ...match,
      minute,
      stats: {
        ...match.stats,
        shots,
      },
    };
  });
  renderMatches();
  updateRefreshPill();
}

function updateRefreshPill() {
  const hasLiveMatch = state.matches.some((match) => match.status === "live");
  const cadence = hasLiveMatch ? "8 s en live" : "3 min hors match";
  const time = state.lastRefresh
    ? state.lastRefresh.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : "--:--";
  els.refreshPill.textContent = `Refresh simulé • ${cadence} • ${time}`;
}

function getSelectedMatch() {
  return state.matches.find((match) => match.id === state.selectedMatchId);
}

function renderStatus(match) {
  const live = match.status === "live" ? `<i class="live-dot"></i>` : "";
  const minute = match.status === "live" && match.minute ? ` • ${match.minute}'` : "";
  return `<span class="status-badge status-${match.status}">${live}${statusLabels[match.status] ?? match.status}${minute}</span>`;
}

function scoreText(match) {
  if (match.status === "upcoming") return "vs";
  return `${match.score?.home ?? 0}-${match.score?.away ?? 0}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLeaderValue(value) {
  return typeof value === "number" && !Number.isInteger(value) ? value.toFixed(2) : value;
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
