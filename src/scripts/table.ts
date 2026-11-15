/**
 * Sortable / filterable ranking table + player drawer. One instance per [data-ranking] element.
 *   data-view    league | conference | team | position   → which precomputed rank is shown in "#"
 *   data-fixed   JSON of fixed filters, e.g. {"team":"LAL"}
 *   data-tabs    conference | position                  → outline-button tabs that switch a fixed filter
 * URL state: ?sort=ts&dir=desc&q=&team=&conf=&pos=&tier=&small=0&page=1
 */
import { COLUMNS, SKILL_KEYS, DISPLAY_EXTRAS, partFmt, f1, type Col, type P } from '../lib/columns';

const BASE = ((b: string) => (b.endsWith('/') ? b : b + '/'))(import.meta.env.BASE_URL);
let playersPromise: Promise<P[]> | null = null;
let metaPromise: Promise<any> | null = null;
export const loadPlayers = () => (playersPromise ??= fetch(BASE + 'data/players.json', { cache: 'no-cache' }).then(r => r.json()));
export const loadMeta = () => (metaPromise ??= fetch(BASE + 'data/meta.json', { cache: 'no-cache' }).then(r => r.json()));

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const PAGE = 50;
const TIERS = ['Starter', 'Substitute', 'Reserve', 'Two-Way'];
const TIER_GROUP: Record<string, string> = { Starter: 'Starters', Substitute: 'Substitutes', Reserve: 'Reserves', 'Two-Way': 'Reserves' };
type View = 'league' | 'conference' | 'team' | 'position';

interface State { sort: string; dir: 'asc' | 'desc'; q: string; team: string; conf: string; pos: string; tier: string; small: boolean; page: number }

export function mountAll() {
  document.querySelectorAll<HTMLElement>('[data-ranking]').forEach(el => new RankingTable(el));
}

class RankingTable {
  el: HTMLElement; view: View; fixed: Record<string, string>; players: P[] = []; state: State; meta: any;
  tbl!: HTMLTableElement; count!: HTMLElement; pager!: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    this.view = (el.dataset.view as View) || 'league';
    this.fixed = JSON.parse(el.dataset.fixed || '{}');
    const u = new URL(location.href).searchParams;
    this.state = {
      sort: u.get('sort') || 'rank', dir: (u.get('dir') as any) || 'asc', q: u.get('q') || '',
      team: this.fixed.team || u.get('team') || '', conf: this.fixed.conf || u.get('conf') || '',
      pos: this.fixed.pos || u.get('pos') || '', tier: u.get('tier') || '', small: u.get('small') === '0' ? false : true,
      page: Math.max(1, Number(u.get('page') || 1)),
    };
    if (el.dataset.tabs === 'conference' && !this.state.conf) this.state.conf = 'East';
    if (el.dataset.tabs === 'position' && !this.state.pos) this.state.pos = 'Guard';
    Promise.all([loadPlayers(), loadMeta()]).then(([p, m]) => { this.players = p; this.meta = m; this.build(); this.render(); })
      .catch(() => { el.innerHTML = `<p class="rt__err">The ratings data didn't load. Check your connection and reload the page.</p>`; });
  }

  // ------------------------------------------------------------------ shell
  build() {
    const tabs = this.el.dataset.tabs;
    const teams = Array.from(new Set(this.players.map(p => p.team))).sort();
    const lockTeam = !!this.fixed.team, lockConf = !!this.fixed.conf || tabs === 'conference' || lockTeam, lockPos = !!this.fixed.pos || tabs === 'position';
    const opt = (v: string, l: string, cur: string) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
    this.el.innerHTML = `
      ${tabs ? `<div class="rt__tabs" role="tablist" aria-label="${tabs === 'conference' ? 'Conference' : 'Position'}">
        ${(tabs === 'conference' ? ['East', 'West'] : ['Guard', 'Forward', 'Center']).map(t => {
          const on = (tabs === 'conference' ? this.state.conf : this.state.pos) === t;
          return `<button class="obtn" role="tab" type="button" data-tab="${t}" aria-selected="${on}">${tabs === 'conference' ? t + 'ern' : t}</button>`;
        }).join('')}
      </div>` : ''}
      <div class="rt__controls">
        <label class="rt__field rt__field--q"><span class="body-bold">Search</span>
          <input type="search" name="q" value="${esc(this.state.q)}" placeholder="Player or team" autocomplete="off" /></label>
        ${lockConf ? '' : `<label class="rt__field"><span class="body-bold">Conference</span><select name="conf">${opt('', 'All', this.state.conf)}${opt('East', 'East', this.state.conf)}${opt('West', 'West', this.state.conf)}</select></label>`}
        ${lockTeam ? '' : `<label class="rt__field"><span class="body-bold">Team</span><select name="team">${opt('', 'All', this.state.team)}${teams.map(t => opt(t, t, this.state.team)).join('')}</select></label>`}
        ${lockPos ? '' : `<label class="rt__field"><span class="body-bold">Position</span><select name="pos">${opt('', 'All', this.state.pos)}${['Guard', 'Forward', 'Center'].map(t => opt(t, t, this.state.pos)).join('')}</select></label>`}
        <label class="rt__field"><span class="body-bold">Tier</span><select name="tier">${opt('', 'All', this.state.tier)}${TIERS.map(t => opt(t, t, this.state.tier)).join('')}</select></label>
        <label class="rt__check"><input type="checkbox" name="small" ${this.state.small ? '' : 'checked'} /><span class="body-bold">Hide small samples</span></label>
      </div>
      <p class="rt__count body-bold" aria-live="polite"></p>
      <div class="rt__scroll" tabindex="0" role="region" aria-label="Rankings table, scrolls sideways">
        <table class="rt"><caption class="sr-only">${esc(this.el.dataset.caption || 'Player rankings')}. Column headers are sort buttons.</caption><thead></thead></table>
      </div>
      <nav class="rt__pager" aria-label="Table pages"></nav>`;
    this.tbl = this.el.querySelector('table')!;
    this.count = this.el.querySelector('.rt__count')!;
    this.pager = this.el.querySelector('.rt__pager')!;

    this.el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.addEventListener('click', () => {
      if (tabs === 'conference') this.state.conf = b.dataset.tab!; else this.state.pos = b.dataset.tab!;
      this.el.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
      this.state.page = 1; this.render(); this.pushUrl();
      this.el.dispatchEvent(new CustomEvent('tabchange', { bubbles: true, detail: b.dataset.tab }));
    }));
    let t: number | undefined;
    this.el.querySelector<HTMLInputElement>('input[name=q]')!.addEventListener('input', e => {
      clearTimeout(t); t = window.setTimeout(() => { this.state.q = (e.target as HTMLInputElement).value; this.state.page = 1; this.render(); this.pushUrl(); }, 150);
    });
    this.el.querySelectorAll<HTMLSelectElement>('select').forEach(s => s.addEventListener('change', () => {
      (this.state as any)[s.name] = s.value; this.state.page = 1; this.render(); this.pushUrl();
    }));
    this.el.querySelector<HTMLInputElement>('input[name=small]')!.addEventListener('change', e => {
      this.state.small = !(e.target as HTMLInputElement).checked; this.state.page = 1; this.render(); this.pushUrl();
    });
    this.tbl.addEventListener('click', e => {
      const sortBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-sort]');
      if (sortBtn) return this.toggleSort(sortBtn.dataset.sort!);
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-pid]');
      if (row) openDrawer(this.players.find(p => p.id === row.dataset.pid)!, this.meta, row);
    });
    // a mouse click on a row shouldn't focus it (focus would scroll the wide table sideways)
    this.tbl.addEventListener('mousedown', e => { if ((e.target as HTMLElement).closest('tr[data-pid]')) e.preventDefault(); });
    this.tbl.addEventListener('keydown', e => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('tr[data-pid]');
      if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDrawer(this.players.find(p => p.id === row.dataset.pid)!, this.meta, row); }
    });
    this.pager.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-page]');
      if (!b) return;
      this.state.page = Number(b.dataset.page); this.render(); this.pushUrl();
      this.el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    addEventListener('popstate', () => location.reload());
  }

  toggleSort(key: string) {
    if (this.state.sort === key) this.state.dir = this.state.dir === 'asc' ? 'desc' : 'asc';
    else { this.state.sort = key; this.state.dir = key === 'rank' || key === 'name' ? 'asc' : COLUMNS.find(c => c.key === key)?.defaultDir ?? 'desc'; }
    this.state.page = 1; this.render(); this.pushUrl();
    this.tbl.querySelector<HTMLButtonElement>(`[data-sort="${key}"]`)?.focus({ preventScroll: true });
  }

  pushUrl() {
    const u = new URL(location.href);
    const s = this.state;
    const set = (k: string, v: string, def = '') => (v && v !== def ? u.searchParams.set(k, v) : u.searchParams.delete(k));
    set('sort', s.sort, 'rank'); set('dir', s.dir, s.sort === 'rank' ? 'asc' : '');
    if (s.sort === 'rank' && s.dir === 'asc') u.searchParams.delete('dir');
    set('q', s.q); set('tier', s.tier); set('page', String(s.page), '1');
    if (!this.fixed.team) set('team', s.team);
    if (!this.fixed.conf) set('conf', s.conf, this.el.dataset.tabs === 'conference' ? '' : '');
    if (!this.fixed.pos) set('pos', s.pos);
    set('small', s.small ? '' : '0');
    history.replaceState(null, '', u);
  }

  // ------------------------------------------------------------------ data
  rankOf(p: P): number {
    return this.view === 'team' ? p.ranks.team : this.view === 'conference' ? p.ranks.conference : this.view === 'position' ? p.ranks.position : p.ranks.league;
  }

  rows(): P[] {
    const s = this.state, q = s.q.trim().toLowerCase();
    let list = this.players.filter(p =>
      (!s.team || p.team === s.team) && (!s.conf || p.conference === s.conf) && (!s.pos || p.posGroup === s.pos) &&
      (!s.tier || p.tier === s.tier) && (s.small || !p.smallSample) &&
      (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase() === q || (p.team + ' ' + p.position).toLowerCase().includes(q)));
    const col = COLUMNS.find(c => c.key === s.sort);
    const val = (p: P) => (s.sort === 'rank' ? this.rankOf(p) : s.sort === 'name' ? p.name : col ? col.get(p) : this.rankOf(p));
    const mul = s.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va === null && vb === null) return this.rankOf(a) - this.rankOf(b);
      if (va === null) return 1; if (vb === null) return -1; // missing values always last
      const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return c * mul || this.rankOf(a) - this.rankOf(b);
    });
    return list;
  }

  // ------------------------------------------------------------------ render
  render() {
    const s = this.state;
    const head = (key: string, label: string, title: string, cls = '') => {
      const active = s.sort === key;
      const sortAttr = active ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none';
      return `<th scope="col" class="${cls}${active ? ' is-sorted' : ''}" aria-sort="${sortAttr}">
        <button type="button" data-sort="${key}" title="${esc(title)}">${label}<span class="rt__arrow" aria-hidden="true">${active ? (s.dir === 'asc' ? '▲' : '▼') : ''}</span></button></th>`;
    };
    const groupHead = (cols: Col[], label: string) => `<th scope="colgroup" colspan="${cols.length}" class="rt__gh">${label}</th>`;
    const core = COLUMNS.filter(c => c.group === 'core'), stat = COLUMNS.filter(c => c.group === 'stat'), skill = COLUMNS.filter(c => c.group === 'skill');
    this.tbl.querySelector('thead')!.innerHTML = `
      <tr class="rt__groups" aria-hidden="true"><th class="rt__sticky" colspan="2"></th>${groupHead(core, 'Rating')}${groupHead(stat, 'Statistics')}${groupHead(skill, 'Skills')}</tr>
      <tr>${head('rank', '#', 'Rank in this view', 'rt__sticky rt__rank')}${head('name', 'Player', 'Player name', 'rt__sticky rt__name')}
      ${COLUMNS.map(c => head(c.key, c.label, c.title, c.group === 'core' ? 'rt__core' : '')).join('')}</tr>`;

    const all = this.rows();
    const paged = all.length > PAGE + 10;
    const pages = paged ? Math.ceil(all.length / PAGE) : 1;
    s.page = Math.min(s.page, pages);
    const slice = paged ? all.slice((s.page - 1) * PAGE, s.page * PAGE) : all;

    this.tbl.querySelectorAll('tbody').forEach(b => b.remove());
    const row = (p: P) => {
      const rank = this.rankOf(p);
      return `<tr data-pid="${p.id}" tabindex="0" aria-label="${esc(p.name)}, rank ${rank}, rating ${p.rating.toFixed(1)}. Open details.">
        <td class="rt__sticky rt__rank tabular${rank === 1 ? ' is-first' : ''}">${rank}</td>
        <th scope="row" class="rt__sticky rt__name"><span class="rt__pname">${esc(p.name)}</span>
          <span class="rt__sub">${p.team} · ${esc(p.position || p.posGroup[0])} · ${p.tier === 'Two-Way' ? '<span class="tag">Two-Way</span>' : p.tier}${p.smallSample ? ' <span class="tag tag--small" title="Fewer than ' + this.meta.config.smallSample.minGP + ' games or under ' + this.meta.config.smallSample.minMPG + ' minutes per game">Small sample</span>' : ''}</span></th>
        ${COLUMNS.map(c => `<td class="tabular${c.group === 'core' ? ' rt__core' : ''}${c.key === 'rating' ? ' rt__rating' : ''}${s.sort === c.key ? ' is-sorted' : ''}" data-label="${c.label}">${c.fmt(c.get(p))}</td>`).join('')}
      </tr>`;
    };
    let html = '';
    if (this.view === 'team' && s.sort === 'rank' && !s.q && !s.tier) {
      // grouped by tier, ordered by team rank inside each group
      for (const g of ['Starters', 'Substitutes', 'Reserves']) {
        const members = slice.filter(p => TIER_GROUP[p.tier] === g);
        if (!members.length) continue;
        html += `<tbody class="rt__tier"><tr class="rt__tierrow"><th scope="rowgroup" colspan="${COLUMNS.length + 2}"><span class="heading3">${g}</span></th></tr>${members.map(row).join('')}</tbody>`;
      }
    } else {
      html = `<tbody>${slice.map(row).join('')}</tbody>`;
    }
    if (!slice.length) html = `<tbody><tr><td colspan="${COLUMNS.length + 2}" class="rt__empty">No players match these filters. Clear the search or set a filter back to All.</td></tr></tbody>`;
    this.tbl.insertAdjacentHTML('beforeend', html);
    // short tables scroll with the page; long ones scroll inside so the header stays pinned
    this.el.querySelector('.rt__scroll')!.classList.toggle('rt__scroll--short', slice.length <= 20);

    const from = all.length ? (paged ? (s.page - 1) * PAGE + 1 : 1) : 0, to = paged ? Math.min(all.length, s.page * PAGE) : all.length;
    const col = s.sort === 'rank' ? 'rank' : s.sort === 'name' ? 'name' : COLUMNS.find(c => c.key === s.sort)?.title.toLowerCase();
    this.count.textContent = `${from}–${to} of ${all.length} players · sorted by ${col}, ${s.dir === 'asc' ? 'ascending' : 'descending'}`;
    this.pager.innerHTML = paged ? `
      <button class="obtn" type="button" data-page="${s.page - 1}" ${s.page === 1 ? 'disabled' : ''}>Previous</button>
      <span class="body-bold">Page ${s.page} of ${pages}</span>
      <button class="obtn" type="button" data-page="${s.page + 1}" ${s.page === pages ? 'disabled' : ''}>Next</button>` : '';
  }
}

// ==================================================================== drawer
let drawer: HTMLDialogElement | null = null;
let returnFocus: HTMLElement | null = null;

const bar = (p: number | null) => {
  if (p === null || p === undefined) return `<span class="pb pb--none" aria-hidden="true"></span>`;
  return `<span class="pb${p >= 90 ? ' pb--elite' : ''}" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, p))}%">${p >= 90 ? '<i></i>' : ''}</span></span>`;
};
const pctText = (p: number | null) => (p === null || p === undefined ? 'no data' : `${Math.round(p)}th pct`);

export function openDrawer(p: P, meta: any, from?: HTMLElement) {
  if (!p) return;
  returnFocus = from ?? (document.activeElement as HTMLElement);
  if (!drawer) {
    drawer = document.createElement('dialog');
    drawer.className = 'drawer';
    drawer.setAttribute('aria-labelledby', 'drawer-title');
    document.body.appendChild(drawer);
    drawer.addEventListener('click', e => { if (e.target === drawer || (e.target as HTMLElement).closest('[data-close]')) drawer!.close(); });
    drawer.addEventListener('close', () => { document.documentElement.classList.remove('drawer-open'); returnFocus?.focus({ preventScroll: true }); });
  }
  const cfg = meta.config;
  const statRows = COLUMNS.filter(c => c.group === 'stat').map(c => {
    const pc = c.pct!(p);
    return `<li><span class="dl__k">${c.title}</span><span class="dl__v tabular">${c.fmt(c.get(p))}</span>${bar(pc)}<span class="dl__p tabular">${pctText(pc)}</span></li>`;
  }).join('');
  const extras = DISPLAY_EXTRAS.map(([k, label, fmt]) => `<li><span class="dl__k">${label}</span><span class="dl__v tabular">${fmt(p.display?.[k] ?? null)}</span></li>`).join('');
  const skills = SKILL_KEYS.map(sk => {
    const def = cfg.skills[sk], s = p.skills[sk];
    return `<section class="dsk"><h4 class="dsk__h"><span>${def.label}</span><span class="tabular">${f1(s.score)}</span></h4>${bar(s.score)}
      <ul class="dl">${Object.entries(def.parts).map(([pk, part]: any) => {
        const v = s.parts[pk];
        return `<li><span class="dl__k">${part.label}</span><span class="dl__v tabular">${partFmt(pk)(v.v)}</span>${bar(v.v === null ? null : v.p)}<span class="dl__p tabular">${v.v === null ? 'no data' : pctText(v.p)}</span></li>`;
      }).join('')}</ul></section>`;
  }).join('');
  const groups = Object.entries(cfg.stats.groups).map(([gk, g]: any) => `<li><span class="dl__k">${g.label} <span class="dl__w">(${Math.round(g.weight * 100)}% of stats)</span></span><span class="dl__v tabular">${f1(p.groupScores[gk])}</span>${bar(p.groupScores[gk])}</li>`).join('');

  drawer.innerHTML = `
    <div class="drawer__panel">
      <button class="drawer__close body-bold ulink" type="button" data-close>Close</button>
      <p class="body-bold drawer__eyebrow">${p.team} · ${p.conference}ern Conference · ${esc(p.position || p.posGroup)}${p.num ? ` · No. ${esc(p.num)}` : ''}</p>
      <h2 id="drawer-title" class="heading3">${esc(p.name)}</h2>
      <p class="drawer__tags"><span class="tag">${p.tier}</span>${p.smallSample ? ` <span class="tag tag--small">Small sample</span>` : ''}</p>
      <div class="drawer__score">
        <div><span class="drawer__big tabular">${f1(p.rating)}</span><span class="body-bold">Rating / 100</span></div>
        <div><span class="drawer__mid tabular">${f1(p.statsScore)}</span><span class="body-bold">Stats · ${Math.round(cfg.final.stats * 100)}%</span></div>
        <div><span class="drawer__mid tabular">${f1(p.skillsScore)}</span><span class="body-bold">Skills · ${Math.round(cfg.final.skills * 100)}%</span></div>
      </div>
      <ul class="drawer__ranks body-bold">
        <li><span>League</span><span class="tabular">#${p.ranks.league}</span></li>
        <li><span>${p.conference}</span><span class="tabular">#${p.ranks.conference}</span></li>
        <li><span>${p.team}</span><span class="tabular">#${p.ranks.team}</span></li>
        <li><span>${p.posGroup}s</span><span class="tabular">#${p.ranks.position}</span></li>
      </ul>
      <h3 class="body-bold drawer__h">Statistics score by group</h3><ul class="dl">${groups}</ul>
      <h3 class="body-bold drawer__h">Every statistic</h3><ul class="dl">${statRows}</ul>
      <h3 class="body-bold drawer__h">Skills</h3>${skills}
      <h3 class="body-bold drawer__h">More numbers (shown, not rated)</h3><ul class="dl">${extras}</ul>
    </div>`;
  document.documentElement.classList.add('drawer-open');
  drawer.showModal();
  drawer.querySelector<HTMLElement>('[data-close]')?.focus();
}
