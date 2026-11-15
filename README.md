# Notturno: NBA ratings 2026-27

Every standard-contract player on all 30 NBA rosters is rated out of 100 from NBA.com data. Players are ranked by team, conference, league and position. A scheduled job refreshes the data every three hours.

## How the rating works

```
Rating = 0.8 × Statistics score + 0.2 × Skills score
```

- **Statistics (80%)**: every stat becomes a league-wide percentile (0–100), on the same scale for every position. Efficiency (TS%, FG%, 3P%, FT%) and impact (PIE, net rating, +/-) count for 60% together. Raw totals (PTS, REB, AST, STL, BLK, TOV, MIN, GP) count for 40%. Turnovers are inverted. Low-volume percentages are pulled toward the league average, so a 1-for-1 shooter doesn't top the charts.
- **Skills (20%)**: six things a box score misses, each measured from NBA.com tracking data:
  - **Hustle**: deflections, loose balls, charges.
  - **Screening**: screen assists, box-outs.
  - **Defensive impact**: opponent FG% compared with normal, plus contests.
  - **Shot creation**: unassisted share, drive points.
  - **Clutch**: last 5 minutes, within 5 points.
  - **On-court impact**: net rating on the floor minus off it.
- **Rosters**: each team's 15 standard contracts. Teams with 14 standard contracts fill the 15th spot with their most-used two-way player. Players are split into tiers:
  - **Starters**: the 5 with the most games started.
  - **Substitutes**: the next 5 by minutes per game.
  - **Reserves**: the rest.
- **Small sample**: fewer than 5 games or under 10 minutes per game gets a badge. These players are still rated.

The site's Methodology page explains all of this in full, with every weight read from the config.

## Retuning

Every weight, threshold, prior and skill definition is in [`config/ratings.config.json`](config/ratings.config.json). Edit it, then:

```bash
npm run compute   # rebuild public/data/*.json from data/raw/bundle.json
npm test          # percentile maths, tiers, two-way fill, positions, 15-per-team
npm run dev
```

Push to `main` and the Deploy workflow rebuilds the site.

## Data pipeline

```
scripts/fetch.py      NBA.com → data/raw/bundle.json   (stats.nba.com, falls back to cdn.nba.com)
scripts/compute.ts    bundle + config → public/data/{players,teams,meta}.json
src/                  Astro static site that reads those JSON files
```

- `.github/workflows/update-data.yml` runs every 3 hours (and on demand from the Actions tab). It runs fetch → compute → test, commits the data if it changed, then builds and deploys to GitHub Pages.
- `.github/workflows/deploy.yml` builds and deploys on every push to `main`.
- If a fetch fails, the previous data stays live. Empty data is never committed.

### If NBA.com blocks GitHub's runners

stats.nba.com often refuses requests from cloud IP ranges. The workflow then tries cdn.nba.com box scores, which rebuild per-game stats but not tracking data. When that happens, skills are carried over from the last good fetch and flagged on the site. To get a full refresh, run the update from your own machine (needs Python 3.10+ and Node 20+):

```bash
python scripts/update_local.py
```

That script fetches, computes and tests, then commits and pushes `data/`. The push triggers a deploy.

## Development

```bash
npm install
npm run fetch      # needs network access to stats.nba.com
npm run compute
npm run dev        # http://localhost:4321/nba-notturno-ratings/
node scripts/og.mjs  # re-render the share cards in public/og (Playwright + Edge/Chrome)
```

## Credits

- Statistics: [NBA.com](https://www.nba.com/stats). This is an independent fan project, not affiliated with the NBA.
- Fonts: Limelight, M PLUS Rounded 1c, Manrope and Allura from Google Fonts (SIL Open Font License).
- Design: the dark-to-paper engraving look was inspired in general terms by cinematic WebGL brand sites. All illustration is procedural (Three.js shaders), and all copy, emblems and sound (synthesised with Web Audio) are original.
