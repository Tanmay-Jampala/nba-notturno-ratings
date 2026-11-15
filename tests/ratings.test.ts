import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  percentiles, shrink, weightedMean, finalRating, positionGroup, buildTeam, computeAll,
  type RosterRow, type Bundle, type Config, type Team,
} from '../src/lib/ratings';

const cfg: Config = JSON.parse(readFileSync(resolve(__dirname, '../config/ratings.config.json'), 'utf-8'));
const teams: Team[] = JSON.parse(readFileSync(resolve(__dirname, '../config/teams.json'), 'utf-8'));

describe('percentiles', () => {
  it('maps worst→0 and best→100 linearly', () => {
    expect(percentiles([10, 20, 30, 40, 50])).toEqual([0, 25, 50, 75, 100]);
  });
  it('inverts for lower-is-better stats', () => {
    expect(percentiles([1, 2, 3], true)).toEqual([100, 50, 0]);
  });
  it('gives tied values the same average-rank percentile', () => {
    const p = percentiles([5, 5, 10, 0]);
    expect(p[0]).toBe(p[1]);
    expect(p[0]).toBeCloseTo(50); // ranks 2 and 3 of 4 → avg 2.5 → (1.5/3)*100
    expect(p[2]).toBe(100);
    expect(p[3]).toBe(0);
  });
  it('scores nulls 0 and leaves them out of the distribution', () => {
    expect(percentiles([null, 1, 2])).toEqual([0, 0, 100]);
  });
  it('handles all-equal and single-value inputs', () => {
    expect(percentiles([3, 3, 3])).toEqual([50, 50, 50]);
    expect(percentiles([7])).toEqual([100]);
  });
});

describe('shrinkage', () => {
  it('pulls a 1-for-1 shooter almost all the way to the league mean', () => {
    const s = shrink(1.0, 1, 40, 0.36)!;
    expect(s).toBeGreaterThan(0.36);
    expect(s).toBeLessThan(0.38);
  });
  it('leaves high-volume shooters nearly untouched', () => {
    expect(shrink(0.42, 400, 40, 0.36)!).toBeCloseTo(0.4145, 3);
  });
});

describe('rating arithmetic', () => {
  it('final = 0.8·stats + 0.2·skills', () => {
    expect(finalRating(80, 50, cfg)).toBeCloseTo(74);
    expect(finalRating(100, 100, cfg)).toBeCloseTo(100);
    expect(cfg.final.stats + cfg.final.skills).toBeCloseTo(1);
  });
  it('stat group weights sum to 1 and efficiency+impact outweigh totals', () => {
    const g = cfg.stats.groups;
    expect(Object.values(g).reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1);
    expect(g.efficiency.weight + g.impact.weight).toBeGreaterThan(g.totals.weight);
  });
  it('weightedMean ignores zero weights', () => {
    expect(weightedMean([[100, 1], [0, 0], [50, 1]])).toBe(75);
  });
});

describe('position mapping', () => {
  it.each([['G', 'Guard'], ['G-F', 'Guard'], ['F-G', 'Forward'], ['F', 'Forward'], ['F-C', 'Forward'], ['C-F', 'Center'], ['C', 'Center'], ['', 'Forward']])(
    '%s → %s', (pos, group) => expect(positionGroup(pos, cfg)).toBe(group),
  );
});

describe('tiers and roster fill', () => {
  const mkRoster = (standard: number, twoWay: number): RosterRow[] => [
    ...Array.from({ length: standard }, (_, i) => ({ id: `s${i}`, name: `S${String(i).padStart(2, '0')}`, position: 'G', twoWay: false })),
    ...Array.from({ length: twoWay }, (_, i) => ({ id: `t${i}`, name: `T${i}`, position: 'F', twoWay: true })),
  ];
  const usage = (ids: string[], gsOf: (i: number) => number, mpgOf: (i: number) => number) => ({
    base: Object.fromEntries(ids.map((id, i) => [id, { GP: 10, MIN: mpgOf(i) }])),
    gs: Object.fromEntries(ids.map((id, i) => [id, gsOf(i)])),
  });

  it('splits 15 standard players 5 / 5 / 5 by games started then minutes', () => {
    const r = mkRoster(15, 3);
    const ids = r.map(x => x.id);
    const b = usage(ids, i => (i < 6 ? 10 - i : 0), i => 40 - i);
    const slots = buildTeam('1', r, b, cfg);
    expect(slots).toHaveLength(15);
    expect(slots.filter(s => s.tier === 'Starter').map(s => s.row.id)).toEqual(['s0', 's1', 's2', 's3', 's4']);
    expect(slots.filter(s => s.tier === 'Substitute').map(s => s.row.id)).toEqual(['s5', 's6', 's7', 's8', 's9']);
    expect(slots.filter(s => s.tier === 'Reserve')).toHaveLength(5);
    expect(slots.some(s => s.row.twoWay)).toBe(false);
  });

  it('breaks games-started ties with minutes per game', () => {
    const r = mkRoster(15, 0);
    const ids = r.map(x => x.id);
    const b = usage(ids, () => 5, i => i); // everyone started 5; s14 plays most
    const starters = buildTeam('1', r, b, cfg).filter(s => s.tier === 'Starter').map(s => s.row.id);
    expect(starters).toEqual(['s14', 's13', 's12', 's11', 's10']);
  });

  it('fills a 14-contract roster with the most-used two-way player, labelled Two-Way', () => {
    const r = mkRoster(14, 3);
    const ids = r.map(x => x.id);
    const b = usage(ids, () => 0, i => (r[i].id === 't2' ? 30 : 10));
    const slots = buildTeam('1', r, b, cfg);
    expect(slots).toHaveLength(15);
    const fill = slots.filter(s => s.tier === 'Two-Way');
    expect(fill.map(s => s.row.id)).toEqual(['t2']);
    expect(fill[0].twoWayFill).toBe(true);
    expect(slots.filter(s => s.tier === 'Reserve')).toHaveLength(4);
  });
});

const bundlePath = resolve(__dirname, '../data/raw/bundle.json');
describe.skipIf(!existsSync(bundlePath))('real data', () => {
  const bundle: Bundle = JSON.parse(readFileSync(bundlePath, 'utf-8'));
  const { players } = computeAll(bundle, teams, cfg);
  it('every team has exactly 15 players', () => {
    for (const t of teams) expect(players.filter(p => p.teamId === t.id), t.abbr).toHaveLength(15);
  });
  it('every rating is within 0–100 and equals 0.8·stats + 0.2·skills', () => {
    for (const p of players) {
      expect(p.rating).toBeGreaterThanOrEqual(0);
      expect(p.rating).toBeLessThanOrEqual(100);
      expect(Math.abs(p.rating - (0.8 * p.statsScore + 0.2 * p.skillsScore))).toBeLessThan(0.15);
    }
  });
  it('ranks are a permutation in every view', () => {
    const league = players.map(p => p.ranks.league).sort((a, b) => a - b);
    expect(league).toEqual(players.map((_, i) => i + 1));
  });
});
