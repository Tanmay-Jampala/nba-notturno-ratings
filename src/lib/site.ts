import metaJson from '../../public/data/meta.json';
import teamsData from '../../public/data/teams.json';

export const BASE = ((b: string) => (b.endsWith('/') ? b : b + '/'))(import.meta.env.BASE_URL);
export const url = (p = '') => BASE + p.replace(/^\//, '');

export const REPO_OWNER = process.env.REPO_OWNER ?? 'tanmay-jampala';
export const REPO_NAME = process.env.REPO_NAME ?? 'nba-notturno-ratings';
export const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;

export const META = metaJson as any;
export const TEAMS = teamsData as Array<{
  id: number; abbr: string; city: string; name: string; conference: 'East' | 'West'; color: string;
  avgRating: number; top: { id: string; name: string; rating: number }; players: string[]; twoWayFill: string[];
}>;

export const NAV = [
  { href: '', label: 'League', match: (p: string) => p === '' },
  { href: 'conferences/', label: 'Conferences', match: (p: string) => p.startsWith('conferences') },
  { href: 'teams/', label: 'Teams', match: (p: string) => p.startsWith('teams') },
  { href: 'positions/', label: 'Positions', match: (p: string) => p.startsWith('positions') },
  { href: 'methodology/', label: 'Methodology', match: (p: string) => p.startsWith('methodology') },
];
