#!/usr/bin/env python3
import argparse
import json
import os
import sys
from datetime import datetime, time, timedelta
from pathlib import Path

from sync_live_scores import (
    apply_competition_defaults,
    load_env_file,
    local_datetime,
    read_state,
    run_upcoming_once,
    write_json,
)
from sync_competition_data import run_once as run_competition_data_once


def main():
    parser = argparse.ArgumentParser(
        description="Passe du matin: scores termines et matchs a venir de la Coupe du Monde."
    )
    parser.add_argument("--matches", default="data/matches.json", help="Fichier JSON des matchs.")
    parser.add_argument("--standings", default="data/standings.json", help="Fichier JSON des classements.")
    parser.add_argument("--players", default="data/players-ea.json", help="Fichier JSON des leaders joueurs.")
    parser.add_argument("--odds", default="data/odds.json", help="Fichier JSON des cotes.")
    parser.add_argument("--kickoffs", default="data/today-kickoffs.json", help="Fichier JSON des coups d'envoi du jour.")
    parser.add_argument("--state", default="data/sync-state.json", help="Memoire locale des sync quotidiennes.")
    parser.add_argument("--env", default=".env", help="Fichier env local optionnel.")
    parser.add_argument("--timezone", default="Europe/Paris", help="Fuseau horaire pour la limite quotidienne.")
    parser.add_argument("--kickoff-window-hour", type=int, default=12, help="Heure locale de debut de la fenetre des coups d'envoi.")
    parser.add_argument("--world-cup-league", type=int, default=None, help="ID API-FOOTBALL de la Coupe du Monde.")
    parser.add_argument("--world-cup-season", type=int, default=None, help="Saison API-FOOTBALL de la Coupe du Monde.")
    parser.add_argument("--lineups-window-hours", type=int, default=36, help="Cherche les compositions des matchs proches.")
    parser.add_argument("--prediction-limit", type=int, default=30, help="Nombre max de matchs a venir avec prediction.")
    parser.add_argument("--dry-run", action="store_true", help="Affiche le resultat sans modifier le fichier.")
    parser.add_argument("--force-today", action="store_true", help="Relance meme si la sync du jour a deja ete faite.")
    args = parser.parse_args()

    load_env_file(Path(args.env))
    apply_competition_defaults(args)

    local_today = local_datetime(args.timezone).date().isoformat()
    state_path = Path(args.state)
    state = read_state(state_path)
    state_key = f"worldCupMorningScoresAndSchedule:{args.world_cup_league}:{args.world_cup_season}"

    if not args.force_today and state.get(state_key) == local_today:
        print("Sync du matin deja faite aujourd'hui. Aucun appel API utilise.")
        return 0

    try:
        run_upcoming_once(args)
        run_competition_data_once(args, os.environ.get("API_FOOTBALL_KEY") or os.environ.get("APISPORTS_KEY"))
        stamp_base_synced(args)
        write_today_kickoffs(args)
    except Exception as error:
        print(f"Erreur synchro du matin: {error}", file=sys.stderr)
        return 1

    if not args.dry_run:
        state[state_key] = local_today
        write_json(state_path, state)

    return 0


# Estampille matches.json a chaque run (meme sans changement de donnees) : sert de
# declencheur au reseed cote Worker (qui adopte la base des qu'elle change).
def stamp_base_synced(args):
    if args.dry_run:
        return
    matches_path = Path(args.matches)
    data = json.loads(matches_path.read_text(encoding="utf-8"))
    data["baseSyncedAt"] = datetime.utcnow().isoformat() + "Z"
    write_json(matches_path, data)


def write_today_kickoffs(args):
    matches_path = Path(args.matches)
    data = json.loads(matches_path.read_text(encoding="utf-8"))
    local_now = local_datetime(args.timezone)
    window_start = datetime.combine(
        local_now.date(),
        time(hour=max(0, min(args.kickoff_window_hour, 23))),
        tzinfo=local_now.tzinfo,
    )
    window_end = window_start + timedelta(days=1)
    kickoffs = []

    for match in data.get("matches", []):
        kickoff = parse_match_datetime(match.get("date"))
        if not kickoff:
            continue
        local_kickoff = kickoff.astimezone(local_now.tzinfo)
        if not (window_start <= local_kickoff < window_end):
            continue
        kickoffs.append({
            "id": match.get("id"),
            "date": match.get("date"),
            "localDate": local_kickoff.date().isoformat(),
            "localTime": local_kickoff.strftime("%H:%M"),
            "stage": match.get("stage"),
            "group": match.get("group"),
            "home": match.get("home"),
            "away": match.get("away"),
            "status": match.get("status"),
        })

    kickoffs.sort(key=lambda item: (item.get("date") or "", str(item.get("id") or "")))
    payload = {
        "lastUpdated": datetime.utcnow().isoformat() + "Z",
        "timezone": args.timezone,
        "windowStart": window_start.isoformat(),
        "windowEnd": window_end.isoformat(),
        "matches": kickoffs,
    }

    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        write_json(Path(args.kickoffs), payload)

    print(format_kickoff_summary(payload))
    append_github_summary(payload)


def parse_match_datetime(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def format_kickoff_summary(payload):
    matches = payload.get("matches") or []
    if not matches:
        return "Coups d'envoi aujourd'hui: aucun match entre midi et midi demain."

    lines = ["Coups d'envoi aujourd'hui:"]
    for match in matches:
        label = f"{match.get('home') or 'Equipe a confirmer'} - {match.get('away') or 'Equipe a confirmer'}"
        lines.append(f"- {match.get('localTime')} {label}")
    return "\n".join(lines)


def append_github_summary(payload):
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return

    matches = payload.get("matches") or []
    lines = [
        "## Coups d'envoi du jour",
        "",
        f"Fenetre: {payload.get('windowStart')} -> {payload.get('windowEnd')} ({payload.get('timezone')})",
        "",
    ]

    if matches:
        lines.extend(
            f"- {match.get('localTime')} - {match.get('home') or 'Equipe a confirmer'} / {match.get('away') or 'Equipe a confirmer'}"
            for match in matches
        )
    else:
        lines.append("- Aucun match.")

    try:
        with Path(summary_path).open("a", encoding="utf-8") as file:
            file.write("\n".join(lines) + "\n")
    except OSError:
        pass


if __name__ == "__main__":
    raise SystemExit(main())
