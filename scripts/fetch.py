"""Fetch 2026-27 NBA data and write a normalised bundle to data/raw/bundle.json.

Order of preference:
  1. stats.nba.com  (full data: rosters, base, advanced, hustle, tracking, clutch, on/off)
  2. cdn.nba.com    (box scores only: base stats are rebuilt from every finished game;
                     rosters and skills are carried over from the last good bundle)
If both fail the previous bundle is left untouched and the script exits with code 2,
so the workflow never commits empty data.

Usage:  python scripts/fetch.py [--source stats|cdn] [--label local]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from nba_http import STATS_HEADERS, get_json, result_sets, stats_url  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
BUNDLE = RAW / "bundle.json"
SEASON = "2026-27"
SEASON_TYPE = "Regular Season"
TEAMS = json.loads((ROOT / "config" / "teams.json").read_text(encoding="utf-8"))

DASH = dict(
    College="", Conference="", Country="", DateFrom="", DateTo="", Division="", DraftPick="",
    DraftYear="", GameScope="", GameSegment="", Height="", LastNGames=0, LeagueID="00",
    Location="", Month=0, OpponentTeamID=0, Outcome="", PORound=0, PaceAdjust="N", Period=0,
    PlayerExperience="", PlayerPosition="", PlusMinus="N", Rank="N", Season=SEASON,
    SeasonSegment="", SeasonType=SEASON_TYPE, ShotClockRange="", StarterBench="", TeamID=0,
    TwoWay=0, VsConference="", VsDivision="", Weight="",
)


def warn(msg: str) -> None:
    # "::warning::" renders as an annotation in GitHub Actions and is harmless locally
    prefix = "::warning::" if os.environ.get("GITHUB_ACTIONS") else "WARNING: "
    print(prefix + msg, flush=True)


def pick(row: dict, keys: list[str]) -> dict:
    return {k: row.get(k) for k in keys}


def first_set(doc: dict) -> list[dict]:
    return next(iter(result_sets(doc).values()), [])


def by_player(rows: list[dict], keys: list[str], id_key: str = "PLAYER_ID") -> dict[str, dict]:
    return {str(r[id_key]): pick(r, keys) for r in rows if r.get(id_key) is not None}


# ----------------------------------------------------------------------------- stats.nba.com
BASE_KEYS = ["PLAYER_NAME", "TEAM_ID", "TEAM_ABBREVIATION", "GP", "MIN", "PTS", "REB", "OREB", "DREB",
             "AST", "STL", "BLK", "TOV", "PF", "FGM", "FGA", "FG_PCT", "FG3M", "FG3A", "FG3_PCT",
             "FTM", "FTA", "FT_PCT", "PLUS_MINUS"]
ADV_KEYS = ["TS_PCT", "EFG_PCT", "NET_RATING", "OFF_RATING", "DEF_RATING", "PIE", "USG_PCT", "AST_TO", "POSS"]


def fetch_stats() -> dict:
    out: dict = {"rosters": {}, "onoff": {}}

    print("· rosters (30 teams)")
    for t in TEAMS:
        rows = result_sets(get_json(stats_url("commonteamroster", LeagueID="00", Season=SEASON, TeamID=t["id"])))[
            "CommonTeamRoster"]
        out["rosters"][str(t["id"])] = [
            {
                "id": str(r["PLAYER_ID"]), "name": r["PLAYER"], "position": r["POSITION"] or "",
                "num": r["NUM"], "height": r["HEIGHT"], "age": r["AGE"], "exp": r["EXP"],
                "twoWay": bool(r.get("SUPPLEMENTAL_STATUS")),
            }
            for r in rows
        ]

    def dash(endpoint: str, keys: list[str], id_key="PLAYER_ID", **extra) -> dict:
        params = {**DASH, **extra}
        return by_player(first_set(get_json(stats_url(endpoint, **params))), keys, id_key)

    print("· base / advanced / scoring / starters")
    out["base"] = dash("leaguedashplayerstats", BASE_KEYS, MeasureType="Base", PerMode="PerGame")
    out["advanced"] = dash("leaguedashplayerstats", ADV_KEYS, MeasureType="Advanced", PerMode="PerGame")
    out["scoring"] = dash("leaguedashplayerstats", ["PCT_UAST_FGM", "PCT_AST_FGM"], MeasureType="Scoring",
                          PerMode="PerGame")
    starters = dash("leaguedashplayerstats", ["GP"], MeasureType="Base", PerMode="Totals", StarterBench="Starters")
    out["gs"] = {pid: v["GP"] for pid, v in starters.items()}

    print("· hustle / defense / drives / clutch")
    hustle_params = {k: v for k, v in DASH.items() if k not in ("GameScope", "GameSegment", "LastNGames",
                                                                "PaceAdjust", "Period", "PlusMinus", "Rank",
                                                                "ShotClockRange", "StarterBench", "TwoWay")}
    out["hustle"] = by_player(first_set(get_json(stats_url("leaguehustlestatsplayer", **hustle_params,
                                                           PerMode="PerGame"))),
                              ["G", "MIN", "DEFLECTIONS", "LOOSE_BALLS_RECOVERED", "CHARGES_DRAWN",
                               "SCREEN_ASSISTS", "BOX_OUTS", "CONTESTED_SHOTS"])
    out["defense"] = dash("leaguedashptdefend", ["GP", "D_FGM", "D_FGA", "D_FG_PCT", "NORMAL_FG_PCT", "PCT_PLUSMINUS"],
                          id_key="CLOSE_DEF_PERSON_ID", DefenseCategory="Overall", PerMode="PerGame")
    out["drives"] = dash("leaguedashptstats", ["GP", "DRIVES", "DRIVE_PTS", "DRIVE_FG_PCT"],
                         PerMode="PerGame", PlayerOrTeam="Player", PtMeasureType="Drives")
    clutch_adv = dash("leaguedashplayerclutch", ["GP", "MIN", "TS_PCT", "NET_RATING"],
                      AheadBehind="Ahead or Behind", ClutchTime="Last 5 Minutes", PointDiff=5,
                      MeasureType="Advanced", PerMode="Totals")
    clutch_base = dash("leaguedashplayerclutch", ["PTS", "FGA", "FTA", "PLUS_MINUS"],
                       AheadBehind="Ahead or Behind", ClutchTime="Last 5 Minutes", PointDiff=5,
                       MeasureType="Base", PerMode="Totals")
    out["clutch"] = {pid: {**v, **clutch_base.get(pid, {})} for pid, v in clutch_adv.items()}

    print("· on/off (30 teams)")
    onoff_keys = ["GP", "MIN", "NET_RATING", "PLUS_MINUS"]
    for t in TEAMS:
        rs = result_sets(get_json(stats_url("teamplayeronoffsummary", **{
            k: v for k, v in DASH.items() if k in ("DateFrom", "DateTo", "GameSegment", "LastNGames", "LeagueID",
                                                 "Location", "Month", "OpponentTeamID", "Outcome", "PaceAdjust",
                                                 "Period", "PlusMinus", "Rank", "Season", "SeasonSegment",
                                                 "SeasonType", "VsConference", "VsDivision")},
                                              TeamID=t["id"], MeasureType="Advanced", PerMode="PerGame")))
        on = by_player(rs.get("PlayersOnCourtTeamPlayerOnOffSummary", []), onoff_keys, "VS_PLAYER_ID")
        off = by_player(rs.get("PlayersOffCourtTeamPlayerOnOffSummary", []), onoff_keys, "VS_PLAYER_ID")
        for pid, v in on.items():
            out["onoff"][pid] = {"on": v, "off": off.get(pid)}
    return out


# ----------------------------------------------------------------------------- cdn.nba.com
CDN_HEADERS = {k: v for k, v in STATS_HEADERS.items() if not k.startswith("x-nba")}


def fetch_cdn(previous: dict | None) -> dict:
    """Rebuild base per-game stats from every finished regular-season box score."""
    sched = get_json("https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json", headers=CDN_HEADERS,
                     timeout=90)
    game_ids = [g["gameId"] for d in sched["leagueSchedule"]["gameDates"] for g in d["games"]
                if g["gameId"].startswith("002") and g.get("gameStatus") == 3]
    print(f"· {len(game_ids)} finished games on the CDN schedule")
    tot: dict[str, dict] = {}
    for gid in game_ids:
        box = get_json(f"https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{gid}.json",
                       headers=CDN_HEADERS)["game"]
        for side in ("homeTeam", "awayTeam"):
            team = box[side]
            for p in team["players"]:
                s = p.get("statistics") or {}
                mins = _iso_minutes(s.get("minutes", "PT0M"))
                if p.get("played") != "1" and mins == 0:
                    continue
                a = tot.setdefault(str(p["personId"]), {"PLAYER_NAME": p["name"], "TEAM_ID": team["teamId"],
                                                        "TEAM_ABBREVIATION": team["teamTricode"], "GP": 0, "GS": 0,
                                                        **{k: 0.0 for k in ("MIN", "PTS", "REB", "OREB", "DREB",
                                                                            "AST", "STL", "BLK", "TOV", "PF", "FGM",
                                                                            "FGA", "FG3M", "FG3A", "FTM", "FTA",
                                                                            "PLUS_MINUS")}})
                a["TEAM_ID"], a["TEAM_ABBREVIATION"] = team["teamId"], team["teamTricode"]
                a["GP"] += 1
                a["GS"] += 1 if p.get("starter") == "1" else 0
                a["MIN"] += mins
                for k, src in (("PTS", "points"), ("REB", "reboundsTotal"), ("OREB", "reboundsOffensive"),
                               ("DREB", "reboundsDefensive"), ("AST", "assists"), ("STL", "steals"),
                               ("BLK", "blocks"), ("TOV", "turnovers"), ("PF", "foulsPersonal"),
                               ("FGM", "fieldGoalsMade"), ("FGA", "fieldGoalsAttempted"),
                               ("FG3M", "threePointersMade"), ("FG3A", "threePointersAttempted"),
                               ("FTM", "freeThrowsMade"), ("FTA", "freeThrowsAttempted"),
                               ("PLUS_MINUS", "plusMinusPoints")):
                    a[k] += float(s.get(src) or 0)
    base, gs = {}, {}
    for pid, a in tot.items():
        gp = a["GP"] or 1
        row = {k: (round(v / gp, 2) if isinstance(v, float) else v) for k, v in a.items()}
        row["FG_PCT"] = round(a["FGM"] / a["FGA"], 3) if a["FGA"] else None
        row["FG3_PCT"] = round(a["FG3M"] / a["FG3A"], 3) if a["FG3A"] else None
        row["FT_PCT"] = round(a["FTM"] / a["FTA"], 3) if a["FTA"] else None
        gs[pid] = row.pop("GS")
        base[pid] = row
    prev = previous or {}
    # advanced impact + every skill need tracking data the CDN doesn't publish: carry them over
    return {"rosters": prev.get("rosters", {}), "base": base, "gs": gs,
            **{k: prev.get(k, {}) for k in ("advanced", "scoring", "hustle", "defense", "drives", "clutch", "onoff")}}


def _iso_minutes(v: str) -> float:
    # "PT34M12.00S"
    try:
        v = v.replace("PT", "")
        m, _, rest = v.partition("M")
        return float(m or 0) + float(rest.replace("S", "") or 0) / 60
    except ValueError:
        return 0.0


# ----------------------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["stats", "cdn"], default=None, help="force one source")
    ap.add_argument("--label", default=None, help="override the source label (e.g. 'local')")
    args = ap.parse_args()

    previous = json.loads(BUNDLE.read_text(encoding="utf-8")) if BUNDLE.exists() else None
    t0 = time.time()
    bundle, source, stale = None, None, {"skills": False, "advanced": False, "rosters": False}

    if args.source in (None, "stats"):
        try:
            print("Fetching from stats.nba.com …")
            bundle, source = fetch_stats(), "stats"
        except Exception as e:  # noqa: BLE001
            warn(f"stats.nba.com failed: {e}")
    if bundle is None and args.source in (None, "cdn"):
        try:
            print("Falling back to cdn.nba.com box scores …")
            bundle, source = fetch_cdn(previous), "cdn"
            stale = {"skills": True, "advanced": True, "rosters": True}
            if not bundle["rosters"]:
                raise RuntimeError("no previous rosters to carry over — run a stats.nba.com fetch first")
        except Exception as e:  # noqa: BLE001
            warn(f"cdn.nba.com failed: {e}")
            bundle = None

    if bundle is None:
        warn("All sources failed. Keeping the previous data/raw/bundle.json; nothing written.")
        return 2

    # sanity: refuse to write an obviously broken bundle
    n_players = len(bundle.get("base", {}))
    n_roster = sum(len(v) for v in bundle["rosters"].values())
    if n_players < 200 or n_roster < 420:
        warn(f"Suspiciously small fetch (players with stats={n_players}, roster players={n_roster}); not writing.")
        return 2

    bundle["meta"] = {
        "season": SEASON, "seasonType": SEASON_TYPE,
        "source": args.label or source,
        "fetchedFrom": source,
        "lastUpdated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stale": stale,
        "previousLastUpdated": (previous or {}).get("meta", {}).get("lastUpdated"),
    }
    RAW.mkdir(parents=True, exist_ok=True)
    tmp = BUNDLE.with_suffix(".tmp")
    tmp.write_text(json.dumps(bundle, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    tmp.replace(BUNDLE)
    print(f"Wrote {BUNDLE.relative_to(ROOT)} from {source}: {n_players} players with stats, "
          f"{n_roster} roster spots, {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
