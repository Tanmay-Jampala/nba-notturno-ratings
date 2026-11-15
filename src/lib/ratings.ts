/**
 * Ratings engine — pure functions, no I/O. Used by scripts/compute.ts and the unit tests.
 *
 *   Final = final.stats × StatisticsScore + final.skills × SkillsScore      (0.8 / 0.2 by default)
 *   StatisticsScore = Σ group.weight × weighted-mean(percentiles of the group's stats)
 *   SkillsScore     = weighted-mean over skills of weighted-mean(percentiles of the skill's parts)
 *
 * Every percentile is league-wide across all rated players (same scale for every position).
 */

export type Num = number | null;
export type Row = Record<string, any>;

export interface RosterRow {
  id: string; name: string; position: string; num?: string; height?: string; age?: number; exp?: string;
  twoWay: boolean;
}

export interface Bundle {
  rosters: Record<string, RosterRow[]>;
  base: Record<string, Row>;
  advanced: Record<string, Row>;
  scoring: Record<string, Row>;
  gs: Record<string, number>;
  hustle: Record<string, Row>;
  defense: Record<string, Row>;
  drives: Record<string, Row>;
  clutch: Record<string, Row>;
  onoff: Record<string, { on: Row | null; off: Row | null }>;
  meta?: Row;
}

export interface Team { id: number; abbr: string; city: string; name: string; conference: 'East' | 'West'; color: string }

export interface Config {
  final: { stats: number; skills: number };
  smallSample: { minGP: number; minMPG: number };
  roster: { size: number; starters: number; substitutes: number };
  positions: Record<string, string>;
  stats: { groups: Record<string, { label: string; weight: number; stats: Record<string, number> }>; lowerIsBetter: string[] };
  shrinkage: Record<string, { basis: string; prior: number; toward?: number } | string>;
  skills: Record<string, {
    label: string; definition: string; source: string; weight: number;
    parts: Record<string, { label: string; weight: number; prior: number; lowerIsBetter?: boolean; toward?: number }>;
  }>;
}

export type Tier = 'Starter' | 'Substitute' | 'Reserve' | 'Two-Way';

// ---------------------------------------------------------------------------------------- maths

/**
 * Percentile rank on a 0–100 scale using average ranks for ties:
 *   p = (averageRank − 1) / (n − 1) × 100     (worst = 0, best = 100)
 * nulls (no data at all) are left out of the distribution and score 0.
 * With lowerIsBetter the order is reversed (fewer turnovers = higher percentile).
 */
export function percentiles(values: Num[], lowerIsBetter = false): number[] {
  const idx = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v !== null && Number.isFinite(x.v));
  const out = values.map(() => 0);
  const n = idx.length;
  if (n === 0) return out;
  if (n === 1) { out[idx[0].i] = 100; return out; }
  idx.sort((a, b) => (lowerIsBetter ? b.v - a.v : a.v - b.v)); // ascending = worst first
  let k = 0;
  while (k < n) {
    let j = k;
    while (j + 1 < n && idx[j + 1].v === idx[k].v) j++;
    const avgRank = (k + j) / 2 + 1; // 1-based average rank of the tie block
    const p = ((avgRank - 1) / (n - 1)) * 100;
    for (let m = k; m <= j; m++) out[idx[m].i] = p;
    k = j + 1;
  }
  return out;
}

/** Empirical-Bayes style shrinkage of a rate toward a prior mean, weighted by volume. */
export function shrink(value: Num, volume: Num, prior: number, mean: number): Num {
  if (value === null || volume === null || !Number.isFinite(value)) return null;
  const n = Math.max(0, volume);
  return (value * n + mean * prior) / (n + prior);
}

export function weightedMean(pairs: Array<[number, number]>): number {
  let s = 0, w = 0;
  for (const [v, wt] of pairs) { if (wt > 0) { s += v * wt; w += wt; } }
  return w > 0 ? s / w : 0;
}

export function finalRating(stats: number, skills: number, cfg: Pick<Config, 'final'>): number {
  return cfg.final.stats * stats + cfg.final.skills * skills;
}

export const round1 = (x: number) => Math.round(x * 10) / 10;

// ---------------------------------------------------------------------------------------- rosters

export function positionGroup(pos: string, cfg: Pick<Config, 'positions'>): string {
  const first = (pos || '').trim().toUpperCase().split(/[-/ ]/)[0]?.[0];
  return (first && cfg.positions[first]) || cfg.positions.default;
}

export interface Slot { row: RosterRow; teamId: string; gs: number; gp: number; mpg: number; twoWayFill: boolean; tier: Tier }

/**
 * Pick each team's 15 and tier them.
 *  - standard contracts first; if more than `size` (mid-season churn) keep the most-used
 *  - if fewer than `size`, fill with the most-used two-way players (label "Two-Way")
 *  - Starters = top `starters` by games started (tie-break MPG); Substitutes = next by MPG; rest Reserves
 */
export function buildTeam(teamId: string, roster: RosterRow[], bundle: Pick<Bundle, 'base' | 'gs'>, cfg: Pick<Config, 'roster'>): Slot[] {
  const use = (r: RosterRow) => {
    const b = bundle.base[r.id];
    const gp = Number(b?.GP ?? 0), mpg = Number(b?.MIN ?? 0);
    return { gs: Number(bundle.gs[r.id] ?? 0), gp, mpg, totalMin: gp * mpg };
  };
  const byUsage = (a: RosterRow, b: RosterRow) => {
    const ua = use(a), ub = use(b);
    return ub.gs - ua.gs || ub.totalMin - ua.totalMin || a.name.localeCompare(b.name);
  };
  let standard = roster.filter(r => !r.twoWay).sort(byUsage).slice(0, cfg.roster.size);
  const need = cfg.roster.size - standard.length;
  const fill = need > 0
    ? roster.filter(r => r.twoWay).sort((a, b) => use(b).totalMin - use(a).totalMin || a.name.localeCompare(b.name)).slice(0, need)
    : [];

  const startOrder = [...standard].sort((a, b) => {
    const ua = use(a), ub = use(b);
    return ub.gs - ua.gs || ub.mpg - ua.mpg || a.name.localeCompare(b.name);
  });
  const starters = startOrder.slice(0, cfg.roster.starters);
  const rest = startOrder.slice(cfg.roster.starters).sort((a, b) => use(b).mpg - use(a).mpg || a.name.localeCompare(b.name));
  const subs = rest.slice(0, cfg.roster.substitutes);
  const reserves = rest.slice(cfg.roster.substitutes);

  const mk = (row: RosterRow, tier: Tier, twoWayFill = false): Slot => {
    const u = use(row);
    return { row, teamId, gs: u.gs, gp: u.gp, mpg: u.mpg, twoWayFill, tier };
  };
  return [
    ...starters.map(r => mk(r, 'Starter')),
    ...subs.map(r => mk(r, 'Substitute')),
    ...reserves.map(r => mk(r, 'Reserve')),
    ...fill.map(r => mk(r, 'Two-Way', true)),
  ];
}

// ---------------------------------------------------------------------------------------- metrics

const n = (x: any): Num => (x === null || x === undefined || x === '' || Number.isNaN(Number(x)) ? null : Number(x));
const per36 = (count: Num, minutes: Num): Num => (count === null || !minutes ? null : (count / minutes) * 36);

export interface RawMetrics { stats: Record<string, Num>; display: Record<string, Num>; basis: Record<string, Num>; parts: Record<string, Num>; partBasis: Record<string, Num> }

export function rawMetrics(id: string, b: Bundle): RawMetrics {
  const base = b.base[id] ?? {}, adv = b.advanced[id] ?? {};
  const gp = n(base.GP) ?? 0;
  const has = gp > 0;
  const g = (k: string) => (has ? n(base[k]) : null);
  const fga = g('FGA'), fta = g('FTA'), pts = g('PTS');
  const tsCalc = has && fga !== null && fta !== null && pts !== null && fga + 0.44 * fta > 0 ? pts / (2 * (fga + 0.44 * fta)) : null;
  const mpg = g('MIN');
  const minTot = has && mpg !== null ? mpg * gp : null;

  const stats: Record<string, Num> = {
    PTS: pts, REB: g('REB'), AST: g('AST'), STL: g('STL'), BLK: g('BLK'), TOV: g('TOV'),
    MIN: mpg, GP: has ? gp : 0, GS: has ? (b.gs[id] ?? 0) : 0,
    FG_PCT: has && (fga ?? 0) > 0 ? g('FG_PCT') : null,
    FG3_PCT: has && (g('FG3A') ?? 0) > 0 ? g('FG3_PCT') : null,
    FT_PCT: has && (fta ?? 0) > 0 ? g('FT_PCT') : null,
    TS_PCT: has ? (n(adv.TS_PCT) ?? tsCalc) : null,
    PLUS_MINUS: g('PLUS_MINUS'),
    NET_RATING: has ? n(adv.NET_RATING) : null,
    PIE: has ? n(adv.PIE) : null,
  };
  const display: Record<string, Num> = {
    OREB: g('OREB'), DREB: g('DREB'), FGM: g('FGM'), FGA: fga, FG3M: g('FG3M'), FG3A: g('FG3A'), FTM: g('FTM'), FTA: fta,
    USG_PCT: has ? n(adv.USG_PCT) : null, OFF_RATING: has ? n(adv.OFF_RATING) : null, DEF_RATING: has ? n(adv.DEF_RATING) : null,
    AST_TO: has ? n(adv.AST_TO) : null,
  };
  const basis: Record<string, Num> = {
    FGA_TOTAL: fga !== null ? fga * gp : null,
    FG3A_TOTAL: g('FG3A') !== null ? (g('FG3A') as number) * gp : null,
    FTA_TOTAL: fta !== null ? fta * gp : null,
    TSA_TOTAL: fga !== null && fta !== null ? (fga + 0.44 * fta) * gp : null,
    MIN_TOTAL: minTot,
  };

  // --- skills
  const h = b.hustle[id], d = b.defense[id], dr = b.drives[id], sc = b.scoring[id], cl = b.clutch[id], oo = b.onoff[id];
  const hMin = h ? (n(h.MIN) ?? 0) * (n(h.G) ?? 0) : null;
  const hTot = (k: string) => (h && n(h[k]) !== null ? (n(h[k]) as number) * (n(h.G) ?? 0) : null);
  const drTot = dr && n(dr.DRIVE_PTS) !== null ? (n(dr.DRIVE_PTS) as number) * (n(dr.GP) ?? 0) : null;
  const clFga = n(cl?.FGA), clFta = n(cl?.FTA), clPts = n(cl?.PTS);
  const clTsa = clFga !== null && clFta !== null ? clFga + 0.44 * clFta : null;
  const onMin = oo?.on ? (n(oo.on.MIN) ?? 0) * (n(oo.on.GP) ?? 0) : null;
  const onNet = n(oo?.on?.NET_RATING), offNet = n(oo?.off?.NET_RATING);

  const parts: Record<string, Num> = {
    DEFLECTIONS_36: per36(hTot('DEFLECTIONS'), hMin),
    LOOSE_BALLS_36: per36(hTot('LOOSE_BALLS_RECOVERED'), hMin),
    CHARGES_36: per36(hTot('CHARGES_DRAWN'), hMin),
    SCREEN_AST_36: per36(hTot('SCREEN_ASSISTS'), hMin),
    BOX_OUTS_36: per36(hTot('BOX_OUTS'), hMin),
    CONTESTS_36: per36(hTot('CONTESTED_SHOTS'), hMin),
    DFG_DIFF: d ? n(d.PCT_PLUSMINUS) : null,
    UAST_SHARE: has && sc ? n(sc.PCT_UAST_FGM) : null,
    DRIVE_PTS_36: per36(drTot, minTot),
    CLUTCH_TS: clTsa && clTsa > 0 && clPts !== null ? clPts / (2 * clTsa) : null,
    CLUTCH_NET: cl ? n(cl.NET_RATING) : null,
    ONOFF_NET: onNet === null ? null : onNet - (offNet ?? 0),
  };
  const partBasis: Record<string, Num> = {
    DEFLECTIONS_36: hMin, LOOSE_BALLS_36: hMin, CHARGES_36: hMin, SCREEN_AST_36: hMin, BOX_OUTS_36: hMin, CONTESTS_36: hMin,
    DFG_DIFF: d ? (n(d.D_FGA) ?? 0) * (n(d.GP) ?? 0) : null,
    UAST_SHARE: has ? (g('FGM') ?? 0) * gp : null,
    DRIVE_PTS_36: minTot,
    CLUTCH_TS: clTsa,
    CLUTCH_NET: cl ? n(cl.MIN) : null,
    ONOFF_NET: onMin,
  };
  return { stats, display, basis, parts, partBasis };
}

/** Volume-weighted league mean of a rate. */
function leagueMean(values: Num[], volumes: Num[]): number {
  let s = 0, w = 0;
  values.forEach((v, i) => { const vol = volumes[i]; if (v !== null && vol !== null && vol > 0) { s += v * vol; w += vol; } });
  return w > 0 ? s / w : 0;
}

// ---------------------------------------------------------------------------------------- full computation

export interface RatedPlayer {
  id: string; name: string; teamId: number; team: string; conference: string;
  position: string; posGroup: string; num: string; height: string; age: number | null; exp: string;
  tier: Tier; twoWay: boolean; smallSample: boolean;
  rating: number; statsScore: number; skillsScore: number;
  groupScores: Record<string, number>;
  ranks: { league: number; conference: number; team: number; position: number };
  stats: Record<string, { v: Num; p: number | null }>;
  display: Record<string, Num>;
  skills: Record<string, { score: number; parts: Record<string, { v: Num; p: number }> }>;
}

export function computeAll(bundle: Bundle, teams: Team[], cfg: Config): { players: RatedPlayer[]; slots: Slot[] } {
  const slots = teams.flatMap(t => buildTeam(String(t.id), bundle.rosters[String(t.id)] ?? [], bundle, cfg));
  const raws = slots.map(s => rawMetrics(s.row.id, bundle));
  const N = slots.length;

  // ---- stats: percentile on (shrunk) values
  const statKeys = Array.from(new Set(Object.values(cfg.stats.groups).flatMap(g => Object.keys(g.stats))));
  const statPct: Record<string, number[]> = {};
  for (const k of statKeys) {
    let vals = raws.map(r => r.stats[k]);
    const sh = cfg.shrinkage[k];
    if (sh && typeof sh === 'object') {
      const vols = raws.map(r => r.basis[sh.basis]);
      const mean = sh.toward ?? leagueMean(vals, vols);
      // with no attempts at all the player is neutral (league average), but only if he has played
      vals = vals.map((v, i) => (raws[i].stats.GP ? shrink(v ?? mean, vols[i] ?? 0, sh.prior, mean) : null));
    }
    statPct[k] = percentiles(vals, cfg.stats.lowerIsBetter.includes(k));
  }

  // ---- skills: per part, shrink toward league mean then percentile
  const partPct: Record<string, number[]> = {};
  for (const skill of Object.values(cfg.skills)) {
    for (const [pk, part] of Object.entries(skill.parts)) {
      const vals = raws.map(r => r.parts[pk]);
      const vols = raws.map(r => r.partBasis[pk]);
      const mean = part.toward ?? leagueMean(vals, vols);
      const shrunk = vals.map((v, i) => (v === null ? null : shrink(v, vols[i] ?? 0, part.prior, mean)));
      partPct[pk] = percentiles(shrunk, !!part.lowerIsBetter);
    }
  }

  const players: RatedPlayer[] = slots.map((s, i) => {
    const r = raws[i];
    const team = teams.find(t => String(t.id) === s.teamId)!;
    const groupScores: Record<string, number> = {};
    let statsScore = 0;
    for (const [gk, g] of Object.entries(cfg.stats.groups)) {
      groupScores[gk] = weightedMean(Object.entries(g.stats).map(([k, w]) => [statPct[k][i], w]));
      statsScore += g.weight * groupScores[gk];
    }
    const skills: RatedPlayer['skills'] = {};
    const skillPairs: Array<[number, number]> = [];
    for (const [sk, skill] of Object.entries(cfg.skills)) {
      const parts: Record<string, { v: Num; p: number }> = {};
      const pairs: Array<[number, number]> = [];
      for (const [pk, part] of Object.entries(skill.parts)) {
        parts[pk] = { v: r.parts[pk], p: round1(partPct[pk][i]) };
        pairs.push([partPct[pk][i], part.weight]);
      }
      const score = weightedMean(pairs);
      skills[sk] = { score: round1(score), parts };
      skillPairs.push([score, skill.weight]);
    }
    const skillsScore = weightedMean(skillPairs);
    const gp = r.stats.GP ?? 0, mpg = r.stats.MIN ?? 0;
    const stats: RatedPlayer['stats'] = {};
    for (const k of statKeys) stats[k] = { v: r.stats[k], p: statPct[k] ? round1(statPct[k][i]) : null };
    return {
      id: s.row.id, name: s.row.name, teamId: team.id, team: team.abbr, conference: team.conference,
      position: s.row.position || '', posGroup: positionGroup(s.row.position, cfg),
      num: s.row.num ?? '', height: s.row.height ?? '', age: s.row.age ?? null, exp: s.row.exp ?? '',
      tier: s.tier, twoWay: s.row.twoWay || s.twoWayFill,
      smallSample: gp < cfg.smallSample.minGP || mpg < cfg.smallSample.minMPG,
      rating: round1(finalRating(statsScore, skillsScore, cfg)),
      statsScore: round1(statsScore), skillsScore: round1(skillsScore),
      groupScores: Object.fromEntries(Object.entries(groupScores).map(([k, v]) => [k, round1(v)])),
      ranks: { league: 0, conference: 0, team: 0, position: 0 },
      stats, display: r.display, skills,
    };
  });

  assignRanks(players);
  return { players, slots };
}

export function compareRating(a: Pick<RatedPlayer, 'rating' | 'statsScore' | 'name'>, b: Pick<RatedPlayer, 'rating' | 'statsScore' | 'name'>) {
  return b.rating - a.rating || b.statsScore - a.statsScore || a.name.localeCompare(b.name);
}

export function assignRanks(players: RatedPlayer[]) {
  const rankBy = (key: keyof RatedPlayer['ranks'], group: (p: RatedPlayer) => string) => {
    const groups = new Map<string, RatedPlayer[]>();
    for (const p of players) { const g = group(p); if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(p); }
    for (const list of groups.values()) list.sort(compareRating).forEach((p, i) => { p.ranks[key] = i + 1; });
  };
  rankBy('league', () => 'all');
  rankBy('conference', p => p.conference);
  rankBy('team', p => p.team);
  rankBy('position', p => p.posGroup);
  players.sort(compareRating);
}
