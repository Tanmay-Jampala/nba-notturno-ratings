/** Top-10 carousel: prev/next buttons, arrow keys, swipe. Slides are built from players.json. */
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function mountCarousel(root: HTMLElement, players: any[], leagueHref: (name: string) => string) {
  const top = players.slice(0, 10);
  const track = root.querySelector<HTMLElement>('[data-track]')!;
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  track.innerHTML = top.map((p, i) => `
    <div class="car__slide" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${top.length}: ${esc(p.name)}" data-i="${i}">
      <span class="car__rank${i === 0 ? ' is-first' : ''}" aria-hidden="true">${i + 1}</span>
      <h3 class="heading3 car__name">${esc(p.name)}</h3>
      <p class="body-bold car__meta">${p.team} · ${esc(p.position)} · ${p.tier}${p.smallSample ? ' · <span class="tag tag--small">Small sample</span>' : ''}</p>
      <p class="car__rating"><span class="tabular">${p.rating.toFixed(1)}</span><span class="body-bold">Rating / 100</span></p>
      <dl class="car__bars">
        <div><dt class="body-bold">Stats</dt><dd><span class="pb"><span style="width:${p.statsScore}%"></span></span><span class="tabular">${p.statsScore.toFixed(1)}</span></dd></div>
        <div><dt class="body-bold">Skills</dt><dd><span class="pb"><span style="width:${p.skillsScore}%"></span></span><span class="tabular">${p.skillsScore.toFixed(1)}</span></dd></div>
      </dl>
      <a class="ulink body-bold car__link" href="${leagueHref(p.name)}" tabindex="-1">Find on the league table</a>
    </div>`).join('');

  let i = 0;
  const slides = Array.from(track.children) as HTMLElement[];
  const go = (n: number, announce = true) => {
    i = (n + slides.length) % slides.length;
    track.style.setProperty('--i', String(i));
    slides.forEach((s, k) => {
      s.classList.toggle('is-active', k === i);
      s.setAttribute('aria-hidden', String(k !== i));
      s.querySelector('a')!.tabIndex = k === i ? 0 : -1;
    });
    if (announce) status.textContent = `Slide ${i + 1} of ${slides.length}: ${top[i].name}, rating ${top[i].rating.toFixed(1)}`;
  };
  root.querySelector('[data-prev]')!.addEventListener('click', () => go(i - 1));
  root.querySelector('[data-next]')!.addEventListener('click', () => go(i + 1));
  root.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
  });
  let x0: number | null = null;
  track.addEventListener('pointerdown', e => { x0 = e.clientX; });
  track.addEventListener('pointerup', e => {
    if (x0 === null) return;
    const dx = e.clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
  });
  go(0, false);
}
