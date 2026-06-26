#!/usr/bin/env python3
import argparse
import copy
import json
import os
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None


API_URL = "https://v3.football.api-sports.io/fixtures"
DEFAULT_WORLD_CUP_LEAGUE = 1
DEFAULT_WORLD_CUP_SEASON = 2026
LIVE_STATUSES = {"1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"}
FINISHED_STATUSES = {"FT", "AET", "PEN"}
UPCOMING_STATUSES = {"NS", "TBD", "PST"}

TEAM_ALIASES = {
    "afrique du sud": {"south africa"},
    "bosnie et herzegovine": {"bosnia and herzegovina", "bosnia"},
    "etats unis": {"usa", "united states", "united states of america"},
    "mexique": {"mexico"},
    "republique de coree": {"south korea", "korea republic", "korea"},
    "suisse": {"switzerland"},
    "tchequie": {"czech republic", "czechia"},
}

TEAM_NAME_FR = {
    "Algeria": "Algérie",
    "Argentina": "Argentine",
    "Australia": "Australie",
    "Austria": "Autriche",
    "Belgium": "Belgique",
    "Brazil": "Brésil",
    "Bosnia and Herzegovina": "Bosnie-et-Herzégovine",
    "Bosnia & Herzegovina": "Bosnie-et-Herzégovine",
    "Cape Verde": "Cap-Vert",
    "Cape Verde Islands": "Cap-Vert",
    "Colombia": "Colombie",
    "Congo DR": "RD Congo",
    "Croatia": "Croatie",
    "Curaçao": "Curaçao",
    "Czechia": "Tchéquie",
    "Ecuador": "Équateur",
    "Egypt": "Égypte",
    "England": "Angleterre",
    "Germany": "Allemagne",
    "Ghana": "Ghana",
    "Haiti": "Haïti",
    "IR Iran": "Iran",
    "Iraq": "Irak",
    "Ivory Coast": "Côte d’Ivoire",
    "Japan": "Japon",
    "Jordan": "Jordanie",
    "Mexico": "Mexique",
    "Morocco": "Maroc",
    "Netherlands": "Pays-Bas",
    "New Zealand": "Nouvelle-Zélande",
    "Norway": "Norvège",
    "Panama": "Panama",
    "Paraguay": "Paraguay",
    "Portugal": "Portugal",
    "Qatar": "Qatar",
    "Scotland": "Écosse",
    "Senegal": "Sénégal",
    "Saudi Arabia": "Arabie saoudite",
    "South Africa": "Afrique du Sud",
    "South Korea": "République de Corée",
    "Spain": "Espagne",
    "Sweden": "Suède",
    "Switzerland": "Suisse",
    "Tunisia": "Tunisie",
    "Türkiye": "Turquie",
    "United States": "États-Unis",
    "USA": "États-Unis",
    "Uruguay": "Uruguay",
    "Uzbekistan": "Ouzbékistan",
}

STAGE_LABELS = {
    "group stage": "groupes",
    "round of 32": "16es",
    "round of 16": "8es",
    "quarter finals": "Quarts",
    "quarter-finals": "Quarts",
    "semi finals": "Demies",
    "semi-finals": "Demies",
    "3rd place final": "3e place",
    "final": "Finale",
}


def main():
    parser = argparse.ArgumentParser(
        description="Met a jour les matchs de Coupe du Monde dans data/matches.json avec API-FOOTBALL."
    )
    parser.add_argument("--matches", default="data/matches.json", help="Fichier JSON des matchs.")
    parser.add_argument("--state", default="data/sync-state.json", help="Memoire locale des sync quotidiennes.")
    parser.add_argument("--env", default=".env", help="Fichier env local optionnel.")
    parser.add_argument("--force", action="store_true", help="Appelle l'API meme hors fenetre live.")
    parser.add_argument("--dry-run", action="store_true", help="Affiche le resultat sans modifier le fichier.")
    parser.add_argument("--watch", action="store_true", help="Relance la verification en boucle.")
    parser.add_argument("--sync-upcoming", action="store_true", help="Met a jour le calendrier Coupe du Monde.")
    parser.add_argument("--no-morning-sync", action="store_true", help="Desactive la sync calendrier du matin en watch.")
    parser.add_argument("--no-post-match-sync", action="store_true", help="Desactive le rattrapage peu apres match.")
    parser.add_argument("--interval-minutes", type=int, default=60, help="Cadence en mode --watch.")
    parser.add_argument("--morning-hour", type=int, default=8, help="Heure locale de la sync calendrier quotidienne.")
    parser.add_argument("--timezone", default="Europe/Paris", help="Fuseau horaire de la sync du matin.")
    parser.add_argument("--world-cup-league", type=int, default=None, help="ID API-FOOTBALL de la Coupe du Monde.")
    parser.add_argument("--world-cup-season", type=int, default=None, help="Saison API-FOOTBALL de la Coupe du Monde.")
    parser.add_argument("--before-minutes", type=int, default=15, help="Marge avant coup d'envoi.")
    parser.add_argument("--after-minutes", type=int, default=150, help="Marge apres coup d'envoi.")
    parser.add_argument("--post-match-after-minutes", type=int, default=165, help="Debut du rattrapage apres coup d'envoi.")
    parser.add_argument("--post-match-until-minutes", type=int, default=360, help="Fin de la fenetre de rattrapage.")
    parser.add_argument("--lineups-window-hours", type=int, default=36, help="Cherche les compositions des matchs proches.")
    args = parser.parse_args()

    load_env_file(Path(args.env))
    apply_competition_defaults(args)

    while True:
        try:
            if args.sync_upcoming:
                run_upcoming_once(args)
            else:
                run_live_once(args)
                if not args.no_post_match_sync:
                    maybe_run_post_match_sync(args)
                if args.watch and not args.no_morning_sync:
                    maybe_run_morning_upcoming_sync(args)
        except Exception as error:
            print(f"Erreur synchro: {error}", file=sys.stderr)
            if not args.watch:
                return 1

        if not args.watch:
            return 0

        time.sleep(max(1, args.interval_minutes) * 60)


def apply_competition_defaults(args):
    args.world_cup_league = int(
        args.world_cup_league
        or os.environ.get("API_FOOTBALL_WORLD_CUP_LEAGUE")
        or DEFAULT_WORLD_CUP_LEAGUE
    )
    args.world_cup_season = int(
        args.world_cup_season
        or os.environ.get("API_FOOTBALL_WORLD_CUP_SEASON")
        or DEFAULT_WORLD_CUP_SEASON
    )


def run_live_once(args):
    matches_path = Path(args.matches)
    data = json.loads(matches_path.read_text(encoding="utf-8"))
    matches = data.get("matches", [])
    now = datetime.now(timezone.utc)
    candidates = find_live_candidates(
        matches,
        now,
        before=timedelta(minutes=args.before_minutes),
        after=timedelta(minutes=args.after_minutes),
    )

    if not args.force and not candidates:
        print("Aucun match dans la fenetre live locale. Aucun appel API utilise.")
        return

    fixtures = fetch_live_fixtures(get_api_key(), args.world_cup_league, args.world_cup_season)
    updated = merge_live_fixtures(matches, fixtures, candidates if candidates else matches)
    checked_at = now.isoformat().replace("+00:00", "Z")

    data["liveSync"] = {
        "provider": "api-football",
        "checkedAt": checked_at,
        "league": args.world_cup_league,
        "season": args.world_cup_season,
        "updatedMatches": updated,
        "localLiveCandidates": [match.get("id") for match in candidates],
    }

    if updated:
        data["lastUpdated"] = checked_at

    if args.dry_run:
        print(json.dumps(data.get("liveSync"), ensure_ascii=False, indent=2))
        return

    write_json(matches_path, data)
    print(f"Synchro terminee: {updated} match(s) mis a jour.")


def run_upcoming_once(args):
    matches_path = Path(args.matches)
    data = json.loads(matches_path.read_text(encoding="utf-8"))
    matches = data.setdefault("matches", [])
    now = datetime.now(timezone.utc)

    fixtures = fetch_world_cup_fixtures(get_api_key(), args.world_cup_league, args.world_cup_season)
    updated, inserted = merge_world_cup_fixtures(matches, fixtures)
    lineups_checked, lineups_updated, fallback_lineups = enrich_available_lineups(
        matches,
        get_api_key(),
        now,
        hours=args.lineups_window_hours,
    )
    checked_at = now.isoformat().replace("+00:00", "Z")

    data["scheduleSync"] = {
        "provider": "api-football",
        "checkedAt": checked_at,
        "league": args.world_cup_league,
        "season": args.world_cup_season,
        "updatedMatches": updated,
        "insertedMatches": inserted,
        "lineupsChecked": lineups_checked,
        "lineupsUpdated": lineups_updated,
        "fallbackLineups": fallback_lineups,
    }

    if updated or inserted or lineups_updated or fallback_lineups:
        data["lastUpdated"] = checked_at
        matches.sort(key=lambda match: (match.get("date") or "", str(match.get("id") or "")))

    if args.dry_run:
        print(json.dumps(data.get("scheduleSync"), ensure_ascii=False, indent=2))
        return

    write_json(matches_path, data)
    print(
        f"Calendrier Coupe du Monde: {updated} match(s) mis a jour, "
        f"{inserted} ajoute(s), {lineups_updated} composition(s), "
        f"{fallback_lineups} derniere(s) compo(s) connue(s)."
    )


def maybe_run_post_match_sync(args):
    matches_path = Path(args.matches)
    data = json.loads(matches_path.read_text(encoding="utf-8"))
    matches = data.get("matches", [])
    now = datetime.now(timezone.utc)
    candidates = find_post_match_candidates(
        matches,
        now,
        after=timedelta(minutes=args.post_match_after_minutes),
        until=timedelta(minutes=args.post_match_until_minutes),
    )

    if not candidates:
        return

    state_path = Path(args.state)
    state = read_state(state_path)
    state_key = f"worldCupPostMatch:{args.world_cup_league}:{args.world_cup_season}"
    synced = set(state.get(state_key, []))
    pending = [match for match in candidates if post_match_key(match) not in synced]

    if not pending:
        return

    fixtures = fetch_world_cup_fixtures(get_api_key(), args.world_cup_league, args.world_cup_season)
    updated, matched, finalized_keys = merge_selected_world_cup_fixtures(matches, fixtures, pending)
    checked_at = now.isoformat().replace("+00:00", "Z")
    data["postMatchSync"] = {
        "provider": "api-football",
        "checkedAt": checked_at,
        "league": args.world_cup_league,
        "season": args.world_cup_season,
        "checkedMatches": [match.get("id") for match in pending],
        "matchedMatches": matched,
        "finalizedMatches": len(finalized_keys),
        "updatedMatches": updated,
    }

    if updated:
        data["lastUpdated"] = checked_at
        matches.sort(key=lambda match: (match.get("date") or "", str(match.get("id") or "")))

    for key in finalized_keys:
        synced.add(key)
    state[state_key] = sorted(synced)

    if args.dry_run:
        print(json.dumps(data.get("postMatchSync"), ensure_ascii=False, indent=2))
        return

    write_json(matches_path, data)
    write_json(state_path, state)
    print(f"Rattrapage apres match: {updated} match(s) mis a jour.")


def maybe_run_morning_upcoming_sync(args):
    local_now = local_datetime(args.timezone)
    if local_now.hour < max(0, min(args.morning_hour, 23)):
        return

    state_path = Path(args.state)
    state = read_state(state_path)
    state_key = f"worldCupMorning:{args.world_cup_league}:{args.world_cup_season}"
    today = local_now.date().isoformat()

    if state.get(state_key) == today:
        return

    run_upcoming_once(args)
    if not args.dry_run:
        state[state_key] = today
        write_json(state_path, state)


def load_env_file(path):
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def get_api_key():
    api_key = os.environ.get("API_FOOTBALL_KEY") or os.environ.get("APISPORTS_KEY")
    if not api_key:
        raise RuntimeError("Cle API manquante. Ajoute API_FOOTBALL_KEY dans .env.")
    return api_key


def find_live_candidates(matches, now, before, after):
    candidates = []
    for match in matches:
        status = match.get("status")
        if status == "finished":
            continue
        if status == "live":
            candidates.append(match)
            continue

        match_date = parse_datetime(match.get("date"))
        if not match_date:
            continue
        if match_date - before <= now <= match_date + after:
            candidates.append(match)
    return candidates


def find_post_match_candidates(matches, now, after, until):
    candidates = []
    for match in matches:
        match_date = parse_datetime(match.get("date"))
        if not match_date:
            continue
        if match_date + after <= now <= match_date + until:
            candidates.append(match)
    return candidates


def fetch_live_fixtures(api_key, league, season):
    return fetch_fixtures(
        api_key,
        {
            "live": "all",
            "league": league,
            "season": season,
        },
    )


def fetch_world_cup_fixtures(api_key, league, season):
    return fetch_fixtures(
        api_key,
        {
            "league": league,
            "season": season,
        },
    )


def fetch_fixture_lineups(api_key, fixture_id):
    return fetch_fixtures_data(api_key, "fixtures/lineups", {"fixture": fixture_id})


def fetch_fixtures(api_key, params):
    return fetch_fixtures_data(api_key, "fixtures", params)


def fetch_fixtures_data(api_key, path, params):
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"https://v3.football.api-sports.io/{path}?{query}",
        headers={
            "x-apisports-key": api_key,
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"API-FOOTBALL a refuse la requete ({error.code}): {body}") from error

    errors = payload.get("errors")
    if has_api_errors(errors):
        raise RuntimeError(f"API-FOOTBALL a retourne une erreur: {errors}")

    if "response" not in payload:
        raise RuntimeError(f"Reponse API inattendue: {payload}")
    return payload["response"]


def has_api_errors(errors):
    if not errors:
        return False
    if isinstance(errors, list):
        return len(errors) > 0
    if isinstance(errors, dict):
        return len(errors) > 0
    return True


def merge_live_fixtures(matches, fixtures, candidates):
    updated = 0
    for fixture in fixtures:
        match = find_local_match(fixture, candidates)
        if not match:
            continue
        apply_fixture(match, fixture)
        updated += 1
    return updated


def merge_world_cup_fixtures(matches, fixtures):
    updated = 0
    inserted = 0

    for fixture in fixtures:
        match = find_local_match(fixture, matches)
        if match:
            before = json.dumps(match, ensure_ascii=False, sort_keys=True)
            apply_schedule_fixture(match, fixture)
            after = json.dumps(match, ensure_ascii=False, sort_keys=True)
            if before != after:
                updated += 1
            continue

        matches.append(create_match_from_fixture(fixture))
        inserted += 1

    return updated, inserted


def merge_selected_world_cup_fixtures(matches, fixtures, selected_matches):
    selected = {id(match): post_match_key(match) for match in selected_matches}
    updated = 0
    matched = 0
    finalized_keys = set()

    for fixture in fixtures:
        match = find_local_match(fixture, matches)
        selected_key = selected.get(id(match)) if match else None
        if not selected_key:
            continue
        matched += 1
        before = json.dumps(match, ensure_ascii=False, sort_keys=True)
        apply_schedule_fixture(match, fixture)
        after = json.dumps(match, ensure_ascii=False, sort_keys=True)
        if before != after:
            updated += 1
        if match.get("status") == "finished":
            finalized_keys.add(selected_key)

    return updated, matched, finalized_keys


def find_local_match(fixture, candidates):
    fixture_id = clean_id(fixture.get("fixture", {}).get("id"))
    for match in candidates:
        external_ids = match.get("externalIds") if isinstance(match.get("externalIds"), dict) else {}
        known_ids = {
            clean_id(match.get("id")),
            clean_id(match.get("apiFootballFixtureId")),
            clean_id(external_ids.get("apiFootball")),
        }
        known_ids.discard("")
        if fixture_id and fixture_id in known_ids:
            return match

    fixture_home = fixture.get("teams", {}).get("home", {}).get("name")
    fixture_away = fixture.get("teams", {}).get("away", {}).get("name")
    fixture_date = parse_datetime(fixture.get("fixture", {}).get("date"))

    for match in candidates:
        if not same_match_day(match.get("date"), fixture_date):
            continue
        if same_team_pair(match.get("home"), match.get("away"), fixture_home, fixture_away):
            return match

    return None


def apply_fixture(match, fixture):
    fixture_status = fixture.get("fixture", {}).get("status", {})
    short_status = fixture_status.get("short")
    elapsed = fixture_status.get("elapsed")
    goals = fixture.get("goals") or {}

    match["status"] = map_status(short_status)
    match["minute"] = elapsed if match["status"] == "live" else None
    match.setdefault("score", {})
    match["score"]["home"] = goals.get("home")
    match["score"]["away"] = goals.get("away")

    fixture_id = fixture.get("fixture", {}).get("id")
    if fixture_id:
        match.setdefault("externalIds", {})
        match["externalIds"]["apiFootball"] = str(fixture_id)


def apply_schedule_fixture(match, fixture):
    fixture_info = fixture.get("fixture", {})
    league_info = fixture.get("league", {})
    teams = fixture.get("teams", {})

    match["date"] = fixture_info.get("date") or match.get("date")
    match["venue"] = fixture_info.get("venue", {}).get("name") or match.get("venue")
    match["city"] = fixture_info.get("venue", {}).get("city") or match.get("city")
    match["stage"] = stage_from_round(league_info.get("round")) or match.get("stage")
    match["group"] = group_from_round(league_info.get("round")) or match.get("group")

    if api_team_name(teams.get("home")):
        match["home"] = api_team_name(teams.get("home"))
    if api_team_name(teams.get("away")):
        match["away"] = api_team_name(teams.get("away"))

    apply_fixture(match, fixture)
    ensure_match_defaults(match)


def create_match_from_fixture(fixture):
    fixture_info = fixture.get("fixture", {})
    league_info = fixture.get("league", {})
    teams = fixture.get("teams", {})
    match = {
        "id": str(fixture_info.get("id")),
        "stage": stage_from_round(league_info.get("round")),
        "group": group_from_round(league_info.get("round")),
        "date": fixture_info.get("date"),
        "venue": fixture_info.get("venue", {}).get("name"),
        "city": fixture_info.get("venue", {}).get("city"),
        "home": api_team_name(teams.get("home")),
        "away": api_team_name(teams.get("away")),
        "homeCoach": None,
        "awayCoach": None,
        "score": {
            "home": None,
            "away": None,
        },
        "scorers": [],
        "highlights": [],
        "externalIds": {
            "apiFootball": str(fixture_info.get("id")),
        },
    }
    apply_fixture(match, fixture)
    ensure_match_defaults(match)
    return match


def clean_id(value):
    if value is None:
        return ""
    return str(value)


def post_match_key(match):
    return f"{clean_id(match.get('id'))}:{match.get('date') or ''}"


def ensure_match_defaults(match):
    match.setdefault("lineups", empty_sides(match.get("home"), match.get("away")))
    match.setdefault("probableLineups", empty_sides(match.get("home"), match.get("away")))
    match.setdefault("stats", {
        "possession": {"home": None, "away": None},
        "shots": {"home": None, "away": None},
        "shotsOnTarget": {"home": None, "away": None},
        "corners": {"home": None, "away": None},
        "fouls": {"home": None, "away": None},
    })
    match.setdefault("playerRatings", {"home": [], "away": []})
    match.setdefault("winProbability", {"home": None, "draw": None, "away": None})
    match.setdefault("expertDiscussion", [])


def empty_sides(home, away):
    return {
        "home": {"team": home, "formation": None, "players": []},
        "away": {"team": away, "formation": None, "players": []},
    }


def stage_from_round(round_name):
    normalized = normalize_round(round_name)
    for key, label in STAGE_LABELS.items():
        if key in normalized:
            return label
    return round_name


def group_from_round(round_name):
    normalized = normalize_round(round_name)
    if "group" not in normalized:
        return None
    return None


def normalize_round(round_name):
    return normalize(str(round_name or "").replace("-", " "))


def api_team_name(team):
    if not isinstance(team, dict):
        return None
    name = team.get("name") or None
    return TEAM_NAME_FR.get(name, name)


def is_placeholder_team(name):
    normalized = normalize(name)
    return not normalized or normalized in {"tbd", "to be defined", "equipe a confirmer"}


def enrich_available_lineups(matches, api_key, now, hours):
    candidates = find_lineup_candidates(matches, now, timedelta(hours=max(0, hours)))
    checked = 0
    updated = 0

    for match in candidates:
        fixture_id = get_api_fixture_id(match)
        if not fixture_id:
            continue
        checked += 1
        lineups = fetch_fixture_lineups(api_key, fixture_id)
        if not lineups:
            continue
        if apply_lineups(match, lineups):
            updated += 1

    fallback_updated = apply_last_known_lineups(matches)
    return checked, updated, fallback_updated


def find_lineup_candidates(matches, now, window):
    candidates = []
    for match in matches:
        match_date = parse_datetime(match.get("date"))
        if not match_date:
            continue
        if match.get("status") == "finished" and not has_lineup_players(match.get("lineups")):
            candidates.append(match)
            continue
        if (
            match.get("status") in {"upcoming", "live"}
            and now - timedelta(hours=1) <= match_date <= now + window
            and not has_lineup_players(match.get("probableLineups" if match.get("status") == "upcoming" else "lineups"))
        ):
            candidates.append(match)
    return candidates


def get_api_fixture_id(match):
    external_ids = match.get("externalIds") if isinstance(match.get("externalIds"), dict) else {}
    return clean_id(external_ids.get("apiFootball") or match.get("apiFootballFixtureId") or match.get("id"))


def apply_lineups(match, lineups):
    before = json.dumps(
        {
            "homeCoach": match.get("homeCoach"),
            "awayCoach": match.get("awayCoach"),
            "lineups": match.get("lineups"),
            "probableLineups": match.get("probableLineups"),
        },
        ensure_ascii=False,
        sort_keys=True,
    )

    target = "probableLineups" if match.get("status") == "upcoming" else "lineups"
    match.setdefault(target, empty_sides(match.get("home"), match.get("away")))

    for lineup in lineups:
        team = api_team_name(lineup.get("team"))
        side = "home" if team_matches(match.get("home"), team) else "away" if team_matches(match.get("away"), team) else None
        if not side:
            continue
        coach = lineup.get("coach", {}).get("name")
        if side == "home" and coach:
            match["homeCoach"] = coach
        if side == "away" and coach:
            match["awayCoach"] = coach
        players = [
            format_lineup_player(row.get("player", {}))
            for row in lineup.get("startXI", [])
            if row.get("player")
        ]
        match[target][side] = {
            "team": team,
            "formation": lineup.get("formation"),
            "players": players,
            "source": "Composition officielle" if target == "lineups" else "Composition probable officielle",
            "sourceDate": match.get("date"),
        }

    after = json.dumps(
        {
            "homeCoach": match.get("homeCoach"),
            "awayCoach": match.get("awayCoach"),
            "lineups": match.get("lineups"),
            "probableLineups": match.get("probableLineups"),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return before != after


def apply_last_known_lineups(matches):
    before = json.dumps(
        [(match.get("id"), match.get("probableLineups"), match.get("homeCoach"), match.get("awayCoach")) for match in matches],
        ensure_ascii=False,
        sort_keys=True,
    )
    known = build_last_known_lineups(matches)

    for match in sorted(matches, key=lambda item: item.get("date") or ""):
        if match.get("status") != "upcoming":
            continue
        match.setdefault("probableLineups", empty_sides(match.get("home"), match.get("away")))
        for side in ("home", "away"):
            current = match["probableLineups"].get(side)
            if has_single_lineup_players(current):
                continue
            team = match.get(side)
            latest = known.get(normalize(team))
            if not latest:
                continue
            fallback = copy.deepcopy(latest["lineup"])
            fallback["team"] = team
            fallback["source"] = "Dernière compo connue"
            fallback["sourceDate"] = latest.get("date")
            fallback["sourceMatch"] = latest.get("matchLabel")
            match["probableLineups"][side] = fallback
            coach = latest.get("coach")
            if coach and side == "home" and not match.get("homeCoach"):
                match["homeCoach"] = coach
            if coach and side == "away" and not match.get("awayCoach"):
                match["awayCoach"] = coach

    after = json.dumps(
        [(match.get("id"), match.get("probableLineups"), match.get("homeCoach"), match.get("awayCoach")) for match in matches],
        ensure_ascii=False,
        sort_keys=True,
    )
    if before == after:
        return 0

    return sum(1 for match in matches if match.get("status") == "upcoming" and has_lineup_players(match.get("probableLineups")))


def build_last_known_lineups(matches):
    known = {}
    for match in sorted(matches, key=lambda item: item.get("date") or ""):
        if match.get("status") != "finished":
            continue
        for side in ("home", "away"):
            lineup = (match.get("lineups") or {}).get(side)
            if not has_single_lineup_players(lineup):
                continue
            team = match.get(side)
            known[normalize(team)] = {
                "date": match.get("date"),
                "coach": match.get(f"{side}Coach"),
                "matchLabel": f"{display_match_team(match.get('home'))} {score_text(match)} {display_match_team(match.get('away'))}",
                "lineup": {
                    "team": team,
                    "formation": lineup.get("formation"),
                    "players": list(lineup.get("players") or []),
                },
            }
    return known


def has_lineup_players(lineups):
    return any(has_single_lineup_players((lineups or {}).get(side)) for side in ("home", "away"))


def has_single_lineup_players(lineup):
    return bool(isinstance(lineup, dict) and lineup.get("players"))


def display_match_team(team):
    return TEAM_NAME_FR.get(team, team or "Équipe à confirmer")


def score_text(match):
    score = match.get("score") or {}
    if score.get("home") is None or score.get("away") is None:
        return "-"
    return f"{score.get('home')}-{score.get('away')}"


def format_lineup_player(player):
    number = player.get("number")
    name = player.get("name")
    position = player.get("pos")
    prefix = f"{number}. " if number else ""
    suffix = f" ({position})" if position else ""
    return f"{prefix}{name}{suffix}".strip()


def map_status(short_status):
    if short_status in LIVE_STATUSES:
        return "live"
    if short_status in FINISHED_STATUSES:
        return "finished"
    if short_status in UPCOMING_STATUSES:
        return "upcoming"
    return "live"


def same_match_day(local_date, fixture_date):
    parsed_local = parse_datetime(local_date)
    if not parsed_local or not fixture_date:
        return True
    return abs(parsed_local - fixture_date) <= timedelta(hours=12)


def same_team_pair(local_home, local_away, fixture_home, fixture_away):
    return team_matches(local_home, fixture_home) and team_matches(local_away, fixture_away)


def team_matches(local_name, api_name):
    local_options = team_options(local_name)
    api_options = team_options(api_name)
    return bool(local_options.intersection(api_options))


def team_options(name):
    normalized = normalize(name)
    options = {normalized}
    options.update(TEAM_ALIASES.get(normalized, set()))
    return {normalize(option) for option in options if option}


def normalize(value):
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.lower().replace("&", " and ")
    for char in "-_.,'\u2019()":
        text = text.replace(char, " ")
    return " ".join(text.split())


def parse_datetime(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def local_datetime(timezone_name):
    if ZoneInfo is None:
        return datetime.now()
    try:
        return datetime.now(ZoneInfo(timezone_name))
    except Exception:
        return datetime.now()


def read_state(path):
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(path)


if __name__ == "__main__":
    raise SystemExit(main())
