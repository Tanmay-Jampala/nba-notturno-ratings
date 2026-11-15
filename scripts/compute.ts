/**
 * data/raw/bundle.json + config/*.json  →  public/data/{players,teams,meta}.json
 * Exits 1 (and writes nothing) if any team does not end up with exactly `roster.size` players.
 *
 *   npx tsx scripts/compute.ts [--print TEAM] [--top N]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeAll, type Bundle, type Config, type Team } from '../src/lib/ratings';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf-8'));

const bundlePath = resolve(ROOT, 'data/raw/bundle.json');
if (!existsSync(bundlePath)) { console.error('No data/raw/bundle.json — run `npm run fetch` first.'); process.exit(1); }

const bundle: Bundle = read('data/raw/bundle.json');
const cfg: Config = read('config/ratings.config.json');
const teams: Team[] = read('config/teams.json');

const { players } = computeAll(bundle, teams, cfg);

// ---- integrity: exactly N per team
const bad = teams.filter(t => players.filter(p => p.teamId === t.id).length !== cfg.roster.size);
if (bad.length) {
  console.error(`✗ Teams without exactly ${cfg.roster.size} players: ` +
    bad.map(t => `${t.abbr}=${players.filter(p => p.teamId === t.id).length}`).join(', '));
  process.exit(1);
}

const teamsOut = teams.map(t => {
  const roster = players.filter(p => p.teamId === t.id).sort((a, b) => a.ranks.team - b.ranks.team);
  const avg = roster.reduce((s, p) => s + p.rating, 0) / roster.length;
  return {
    ...t,
    avgRating: Math.round(avg * 10) / 10,
    top: { id: roster[0].id, name: roster[0].name, rating: roster[0].rating },
    players: roster.map(p => p.id),
    twoWayFill: roster.filter(p => p.tier === 'Two-Way').map(p => p.id),
  };
});

const meta = {
  ...bundle.meta,
  counts: { players: players.length, teams: teams.length, smallSample: players.filter(p => p.smallSample).length },
  config: cfg,
};

const out = resolve(ROOT, 'public/data');
mkdirSync(out, { recursive: true });
const trim = (_k: string, v: unknown) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v);
writeFileSync(resolve(out, 'players.json'), JSON.stringify(players, trim));
writeFileSync(resolve(out, 'teams.json'), JSON.stringify(teamsOut));
writeFileSync(resolve(out, 'meta.json'), JSON.stringify(meta, null, 1));
console.log(`✓ ${players.length} players · ${teams.length} teams · source=${meta.source} · ${meta.lastUpdated}`);

// ---- optional console previews
const args = process.argv.slice(2);
const topN = args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) : 0;
if (topN) {
  console.log(`\nTop ${topN} — league`);
  for (const p of players.slice(0, topN))
    console.log(`${String(p.ranks.league).padStart(3)}  ${p.rating.toFixed(1).padStart(5)}  S${p.statsScore.toFixed(1).padStart(5)} K${p.skillsScore.toFixed(1).padStart(5)}  ${p.team}  ${p.posGroup.padEnd(7)} ${p.tier.padEnd(10)} ${p.name}${p.smallSample ? '  [small sample]' : ''}`);
}
if (args.includes('--print')) {
  const abbr = args[args.indexOf('--print') + 1];
  const t = teamsOut.find(x => x.abbr === abbr);
  if (t) {
    console.log(`\n${t.city} ${t.name} — avg ${t.avgRating}`);
    for (const id of t.players) {
      const p = players.find(x => x.id === id)!;
      const s = p.stats;
      console.log(`${String(p.ranks.team).padStart(2)}  ${p.rating.toFixed(1).padStart(5)}  ${p.tier.padEnd(10)} ${p.name.padEnd(24)} GP ${s.GP.v} GS ${s.GS.v}  ${(s.MIN.v ?? 0).toFixed(1)}m  ${s.PTS.v ?? '-'}/${s.REB.v ?? '-'}/${s.AST.v ?? '-'}  TS ${s.TS_PCT.v ?? '-'}${p.smallSample ? '  [small]' : ''}`);
    }
  }
}
