#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from sync_live_scores import (
    TEAM_NAME_FR,
    apply_competition_defaults,
    get_api_fixture_id,
    load_env_file,
    write_json,
)


API_BASE_URL = "https://v3.football.api-sports.io"

EXTRA_TEAM_NAME_FR = {
    "Algeria": "Algérie",
    "Cape Verde Islands": "Cap-Vert",
    "Colombia": "Colombie",
    "Congo DR": "RD Congo",
    "Curaçao": "Curaçao",
    "Czechia": "Tchéquie",
    "Ecuador": "Équateur",
    "Iran": "Iran",
    "Ivory Coast": "Côte d’Ivoire",
    "Panama": "Panama",
    "Paraguay": "Paraguay",
    "Turkey": "Turquie",
}


def main():
    parser = argparse.ArgumentParser(
        description="Met a jour classements, leaders, cotes et probabilites Coupe du Monde."
    )
    parser.add_argument("--matches", default="data/matches.json", help="Fichier JSON des matchs.")
    parser.add_argument("--standings", default="data/standings.json", help="Fichier JSON des classements.")
    parser.add_argument("--players", default="data/players-ea.json", help="Fichier JSON des leaders joueurs.")
    parser.add_argument("--odds", default="data/odds.json", help="Fichier JSON des cotes.")
    parser.add_argument("--env", default=".env", help="Fichier env local optionnel.")
    parser.add_argument("--world-cup-league", type=int, default=None, help="ID API-FOOTBALL de la Coupe du Monde.")
    parser.add_argument("--world-cup-season", type=int, default=None, help="Saison API-FOOTBALL de la Coupe du Monde.")
    parser.add_argument("--prediction-limit", type=int, default=30, help="Nombre max de matchs a venir avec prediction.")
    parser.add_argument("--dry-run", action="store_true", help="Affiche le resultat sans modifier les fichiers.")
    args = parser.parse_args()

    load_env_file(Path(args.env))
    apply_competition_defaults(args)

    api_key = os.environ.get("API_FOOTBALL_KEY") or os.environ.get("APISPORTS_KEY")
    if not api_key:
        print("Cle API manquante. Ajoute API_FOOTBALL_KEY dans .env.", file=sys.stderr)
        return 1

    try:
        summary = run_once(args, api_key)
    except Exception as error:
        print(f"Erreur synchro donnees competition: {error}", file=sys.stderr)
        return 1

    print(
        "Donnees competition: "
        f"{summary['groups']} groupe(s), "
        f"{summary['topScorers']} buteur(s), "
        f"{summary['topAssists']} passeur(s), "
        f"{summary['topPlayers']} joueur(s) note(s), "
        f"{summary['oddsMarkets']} match(s) avec cotes, "
        f"{summary['predictions']} prediction(s)."
    )
    return 0


def run_once(args, api_key):
    checked_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    matches_path = Path(args.matches)
    matches_data = json.loads(matches_path.read_text(encoding="utf-8"))
    matches = matches_data.get("matches", [])

    standings_data = build_standings(api_key, args.world_cup_league, args.world_cup_season, checked_at)
    players_data = build_players(api_key, args.world_cup_league, args.world_cup_season, checked_at)
    odds_data = build_odds(api_key, args.world_cup_league, args.world_cup_season, matches, checked_at)
    predictions = apply_predictions(
        api_key,
        matches,
        limit=max(0, args.prediction_limit),
    )

    if predictions:
        matches_data["lastUpdated"] = checked_at
        matches_data["predictionSync"] = {
            "provider": "api-football",
            "checkedAt": checked_at,
            "updatedMatches": predictions,
        }

    summary = {
        "groups": len(standings_data.get("groups", [])),
        "topScorers": len(players_data.get("topScorers", [])),
        "topAssists": len(players_data.get("topAssists", [])),
        "topPlayers": len(players_data.get("topPlayers", [])),
        "oddsMarkets": len(odds_data.get("markets", {})),
        "predictions": predictions,
    }

    if args.dry_run:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return summary

    write_json(Path(args.standings), standings_data)
    write_json(Path(args.players), players_data)
    write_json(Path(args.odds), odds_data)
    if predictions:
        write_json(matches_path, matches_data)
    return summary


def build_standings(api_key, league, season, checked_at):
    payload = fetch_api(api_key, "standings", {"league": league, "season": season})
    league_rows = payload[0].get("league", {}).get("standings", []) if payload else []
    groups = []

    for group_rows in league_rows:
        if not group_rows:
            continue
        group_name = format_group_name(group_rows[0].get("group"))
        if not is_world_cup_group_name(group_name):
            continue
        teams = [format_standing_team(row) for row in group_rows]
        groups.append({"name": group_name, "teams": teams})

    return {
        "lastUpdated": checked_at,
        "source": "api-football",
        "groups": groups,
    }


def format_standing_team(row):
    all_stats = row.get("all") or {}
    description = row.get("description") or ""
    rank = row.get("rank")
    played = all_stats.get("played")
    status = ""

    if description:
        status = "best-third" if rank == 3 else "qualified"
    elif played and played >= 3:
        status = "eliminated"

    return {
        "rank": rank,
        "name": display_team_name(row.get("team", {}).get("name")),
        "played": played,
        "points": row.get("points"),
        "gd": row.get("goalsDiff"),
        "status": status,
    }


def build_players(api_key, league, season, checked_at):
    top_scorers = [
        format_player(row, value_key="goals", source_key=("goals", "total"))
        for row in fetch_api(api_key, "players/topscorers", {"league": league, "season": season})
    ]
    top_assists = [
        format_player(row, value_key="assists", source_key=("goals", "assists"))
        for row in fetch_api(api_key, "players/topassists", {"league": league, "season": season})
    ]
    return {
        "lastUpdated": checked_at,
        "source": "api-football",
        "topScorers": [player for player in top_scorers if player.get("goals")],
        "topAssists": [player for player in top_assists if player.get("assists")],
        "topPlayers": [],
        "youngPlayers": [],
    }


def build_odds(api_key, league, season, matches, checked_at):
    odds = fetch_api(api_key, "odds", {"league": league, "season": season})
    match_by_fixture = {
        str(get_api_fixture_id(match)): match
        for match in matches
        if get_api_fixture_id(match)
    }
    markets = {}

    for fixture_odds in odds:
        fixture_id = str((fixture_odds.get("fixture") or {}).get("id") or "")
        match = match_by_fixture.get(fixture_id)
        if not match:
            continue

        books = []
        for bookmaker in fixture_odds.get("bookmakers", []):
            market = find_match_winner_market(bookmaker.get("bets", []))
            if not market:
                continue
            books.append({
                "bookmaker": bookmaker.get("name"),
                "home": market.get("Home"),
                "draw": market.get("Draw"),
                "away": market.get("Away"),
            })

        if books:
            markets[match.get("id")] = books[:5]

    return {
        "lastUpdated": checked_at,
        "source": "api-football",
        "markets": markets,
    }


def apply_predictions(api_key, matches, limit):
    updated = 0
    upcoming = [
        match for match in sorted(matches, key=lambda item: item.get("date") or "")
        if match.get("status") == "upcoming" and get_api_fixture_id(match)
    ][:limit]

    for match in upcoming:
        try:
            response = fetch_api(api_key, "predictions", {"fixture": get_api_fixture_id(match)})
        except RuntimeError as error:
            if "rateLimit" in str(error):
                break
            raise
        if not response:
            continue
        percent = ((response[0].get("predictions") or {}).get("percent") or {})
        probabilities = {
            "home": parse_percent(percent.get("home")),
            "draw": parse_percent(percent.get("draw")),
            "away": parse_percent(percent.get("away")),
        }
        if all(value is None for value in probabilities.values()):
            continue
        if match.get("winProbability") != probabilities:
            match["winProbability"] = probabilities
            updated += 1
        advice = (response[0].get("predictions") or {}).get("advice")
        if advice:
            match["expertDiscussion"] = [advice]

    return updated


def fetch_api(api_key, path, params):
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{API_BASE_URL}/{path}?{query}",
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
        raise RuntimeError(f"API-FOOTBALL a refuse {path} ({error.code}): {body}") from error

    errors = payload.get("errors")
    if errors:
        raise RuntimeError(f"API-FOOTBALL a retourne une erreur pour {path}: {errors}")
    if "response" not in payload:
        raise RuntimeError(f"Reponse API inattendue pour {path}: {payload}")
    return payload["response"]


def format_player(row, value_key, source_key):
    player = row.get("player") or {}
    stats = (row.get("statistics") or [{}])[0] or {}
    value = nested_value(stats, source_key)

    return {
        "name": player.get("name"),
        "team": display_team_name((stats.get("team") or {}).get("name")),
        "age": player.get("age"),
        value_key: parse_number(value),
    }


def nested_value(data, keys):
    current = data
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def find_match_winner_market(bets):
    for bet in bets:
        if bet.get("name") != "Match Winner":
            continue
        values = {}
        for value in bet.get("values", []):
            odd = parse_number(value.get("odd"))
            if odd is not None:
                values[value.get("value")] = odd
        if {"Home", "Draw", "Away"}.issubset(values):
            return values
    return None


def parse_number(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_percent(value):
    if value is None:
        return None
    parsed = parse_number(str(value).replace("%", ""))
    if parsed is None:
        return None
    return int(round(parsed))


def display_team_name(name):
    return EXTRA_TEAM_NAME_FR.get(name, TEAM_NAME_FR.get(name, name))


def format_group_name(name):
    if not name:
        return "Groupe"
    return str(name).replace("Group ", "Groupe ")


def is_world_cup_group_name(name):
    return str(name or "").strip() in {f"Groupe {letter}" for letter in "ABCDEFGHIJKL"}


if __name__ == "__main__":
    raise SystemExit(main())
