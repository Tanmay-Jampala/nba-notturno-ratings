/** Column + formatting definitions shared by the table island, the drawer and the methodology page. */
export type P = any; // RatedPlayer as serialised in public/data/players.json

export interface Col {
  key: string;          // URL sort key
  label: string;        // header text
  title: string;        // full name (aria / tooltip)
  get: (p: P) => number | string | null;
  fmt: (v: any) => string;
  group: 'core' | 'stat' | 'skill';
  pct?: (p: P) => number | null;  // percentile for the drawer
  defaultDir?: 'asc' | 'desc';
}

const dash = '–';
export const f1 = (v: number | null) => (v === null || v === undefined ? dash : v.toFixed(1));
export const fInt = (v: number | null) => (v === null || v === undefined ? dash : String(Math.round(v)));
export const fPct = (v: number | null) => (v === null || v === undefined ? dash : (v * 100).toFixed(1) + '%');
export const fSigned = (v: number | null) => (v === null || v === undefined ? dash : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1));

const stat = (key: string, label: string, title: string, k: string, fmt: Col['fmt'], dir: 'asc' | 'desc' = 'desc'): Col => ({
  key, label, title, group: 'stat', fmt, defaultDir: dir,
  get: p => p.stats[k]?.v ?? null,
  pct: p => p.stats[k]?.p ?? null,
});
const skill = (key: string, label: string, title: string, k: string): Col => ({
  key, label, title, group: 'skill', fmt: f1, defaultDir: 'desc',
  get: p => p.skills[k]?.score ?? null,
  pct: p => p.skills[k]?.score ?? null,
});

export const COLUMNS: Col[] = [
  { key: 'rating', label: 'Rating', title: 'Overall rating out of 100', group: 'core', fmt: f1, get: p => p.rating, defaultDir: 'desc' },
  { key: 'stats', label: 'Stats', title: 'Statistics score (80% of rating)', group: 'core', fmt: f1, get: p => p.statsScore, defaultDir: 'desc' },
  { key: 'skills', label: 'Skills', title: 'Skills score (20% of rating)', group: 'core', fmt: f1, get: p => p.skillsScore, defaultDir: 'desc' },
  stat('pts', 'PPG', 'Points per game', 'PTS', f1),
  stat('reb', 'RPG', 'Rebounds per game', 'REB', f1),
  stat('ast', 'APG', 'Assists per game', 'AST', f1),
  stat('stl', 'SPG', 'Steals per game', 'STL', f1),
  stat('blk', 'BPG', 'Blocks per game', 'BLK', f1),
  stat('tov', 'TOV', 'Turnovers per game (fewer is better)', 'TOV', f1, 'asc'),
  stat('min', 'MIN', 'Minutes per game', 'MIN', f1),
  stat('gp', 'GP', 'Games played', 'GP', fInt),
  stat('gs', 'GS', 'Games started', 'GS', fInt),
  stat('fg', 'FG%', 'Field-goal percentage', 'FG_PCT', fPct),
  stat('fg3', '3P%', 'Three-point percentage', 'FG3_PCT', fPct),
  stat('ft', 'FT%', 'Free-throw percentage', 'FT_PCT', fPct),
  stat('ts', 'TS%', 'True shooting percentage', 'TS_PCT', fPct),
  stat('pm', '+/-', 'Plus-minus per game', 'PLUS_MINUS', fSigned),
  stat('net', 'NET', 'Net rating (points per 100 possessions)', 'NET_RATING', fSigned),
  stat('pie', 'PIE', 'Player impact estimate', 'PIE', fPct),
  skill('hustle', 'Hustle', 'Hustle skill (0–100)', 'hustle'),
  skill('screening', 'Screen', 'Screening & off-ball skill (0–100)', 'screening'),
  skill('defense', 'Defense', 'Defensive impact skill (0–100)', 'defense'),
  skill('creation', 'Create', 'Shot creation skill (0–100)', 'creation'),
  skill('clutch', 'Clutch', 'Clutch skill (0–100)', 'clutch'),
  skill('onoff', 'On/Off', 'On-court impact skill (0–100)', 'onOff'),
];

export const SKILL_KEYS = ['hustle', 'screening', 'defense', 'creation', 'clutch', 'onOff'] as const;

/** How each skill part value should be shown. */
export const PART_FMT: Record<string, (v: number | null) => string> = {
  DFG_DIFF: v => (v === null ? dash : fSigned(v * 100) + ' pts'),
  UAST_SHARE: fPct,
  CLUTCH_TS: fPct,
  CLUTCH_NET: fSigned,
  ONOFF_NET: fSigned,
};
export const partFmt = (k: string) => PART_FMT[k] ?? f1;

/** Extra advanced numbers shown in the drawer (not rated). */
export const DISPLAY_EXTRAS: Array<[string, string, (v: any) => string]> = [
  ['USG_PCT', 'Usage %', fPct],
  ['OFF_RATING', 'Offensive rating', f1],
  ['DEF_RATING', 'Defensive rating', f1],
  ['AST_TO', 'Assist / turnover', v => (v === null ? dash : v.toFixed(2))],
  ['OREB', 'Offensive rebounds', f1],
  ['DREB', 'Defensive rebounds', f1],
  ['FGA', 'FG attempts', f1],
  ['FG3A', '3P attempts', f1],
  ['FTA', 'FT attempts', f1],
];
