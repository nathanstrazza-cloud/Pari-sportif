#!/usr/bin/env python3
import argparse
import os
import sys
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
    parser.add_argument("--state", default="data/sync-state.json", help="Memoire locale des sync quotidiennes.")
    parser.add_argument("--env", default=".env", help="Fichier env local optionnel.")
    parser.add_argument("--timezone", default="Europe/Paris", help="Fuseau horaire pour la limite quotidienne.")
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
    except Exception as error:
        print(f"Erreur synchro du matin: {error}", file=sys.stderr)
        return 1

    if not args.dry_run:
        state[state_key] = local_today
        write_json(state_path, state)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
