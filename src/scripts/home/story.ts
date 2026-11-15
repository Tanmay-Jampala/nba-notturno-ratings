/**
 * Home orchestration: loader → gate → scroll story (Three.js + GSAP ScrollTrigger + Lenis) → carousel.
 * With prefers-reduced-motion or without WebGL, html gets .story-static and the story renders as stacked sections.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { audio } from './audio';
import { mountCarousel } from './carousel';
import { loadPlayers } from '../table';

gsap.registerPlugin(ScrollTrigger);

const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  sget(k: string) { try { return sessionStorage.getItem(k); } catch { return null; } },
  sset(k: string, v: string) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ------------------------------------------------------------------------------------------ keyframes
type V3 = [number, number, number];
interface Key { t: number; pos: V3; look: V3; night: number; sun: number; beams: number; walk: number; figZ: number; fov: number }
const KEYS: Key[] = [
  { t: 0.0, pos: [0, 1.9, 15], look: [0, 2.3, -6], night: 1, sun: 0, beams: 0, walk: 0, figZ: 5, fov: 40 },
  { t: 0.08, pos: [0, 1.6, 12], look: [0, 2.4, -30], night: 0, sun: 1, beams: 0, walk: 1, figZ: 4.5, fov: 42 },
  { t: 0.28, pos: [0.7, 1.4, 6.5], look: [0, 2.8, -40], night: 0, sun: 1, beams: 0, walk: 1, figZ: -1, fov: 42 },
  { t: 0.36, pos: [2.8, 2.6, -2.2], look: [0, 2.3, -6], night: 0, sun: 1, beams: 0, walk: 0, figZ: -1.6, fov: 38 },
  { t: 0.52, pos: [-2.5, 2.0, -3.1], look: [0, 2.3, -6], night: 0, sun: 0.7, beams: 0, walk: 0, figZ: -1.6, fov: 36 },
  { t: 0.6, pos: [0, 2.4, -9.5], look: [0, 3.05, -20.75], night: 0, sun: 0, beams: 0, walk: 0, figZ: -1.6, fov: 38 },
  { t: 0.74, pos: [0, 3.05, -16.2], look: [0, 3.1, -20.75], night: 0, sun: 0, beams: 0, walk: 0, figZ: -1.6, fov: 34 },
  { t: 0.82, pos: [0, 4.5, -12], look: [0, 12, -32], night: 1, sun: 0, beams: 0.6, walk: 0, figZ: -1.6, fov: 44 },
  { t: 0.94, pos: [0, 9.5, -15], look: [0, 22, -48], night: 1, sun: 0, beams: 1, walk: 0, figZ: -1.6, fov: 46 },
  { t: 1.0, pos: [0, 12, -19], look: [0, 26, -58], night: 1, sun: 0, beams: 1, walk: 0, figZ: -1.6, fov: 46 },
];
const ease = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function poseAt(p: number) {
  let k = 0;
  while (k < KEYS.length - 2 && p > KEYS[k + 1].t) k++;
  const a = KEYS[k], b = KEYS[k + 1];
  const t = ease(Math.min(1, Math.max(0, (p - a.t) / (b.t - a.t))));
  const v = (x: V3, y: V3): V3 => [lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)];
  return {
    pos: v(a.pos, b.pos), look: v(a.look, b.look), night: lerp(a.night, b.night, t), sun: lerp(a.sun, b.sun, t),
    beams: lerp(a.beams, b.beams, t), walk: lerp(a.walk, b.walk, t), figZ: lerp(a.figZ, b.figZ, t), fov: lerp(a.fov, b.fov, t),
  };
}

// ------------------------------------------------------------------------------------------ overlays
interface Beat { el: HTMLElement; a: number; b: number; words?: HTMLElement[] }
function collectBeats(): Beat[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-beat]')).map(el => {
    const [a, b] = el.dataset.beat!.split(',').map(Number);
    const cap = el.querySelector<HTMLElement>('[data-type]');
    let words: HTMLElement[] | undefined;
    if (cap) {
      const text = cap.textContent!.trim();
      cap.setAttribute('aria-label', text);
      cap.innerHTML = text.split(/\s+/).map(w => `<span class="tw" aria-hidden="true">${w}</span>`).join(' ');
      words = Array.from(cap.querySelectorAll<HTMLElement>('.tw'));
    }
    return { el, a, b, words };
  });
}

function paintBeats(beats: Beat[], p: number) {
  for (const bt of beats) {
    const span = bt.b - bt.a, fade = Math.min(0.025, span * 0.25);
    const inV = bt.a <= 0 ? 1 : Math.max(0, (p - bt.a) / fade);   // first beat is already in at p = 0
    const outV = bt.b >= 1 ? 1 : Math.max(0, (bt.b - p) / fade);  // last beat stays in at p = 1
    const vis = Math.min(1, inV, outV);
    bt.el.style.opacity = String(vis);
    bt.el.style.visibility = vis > 0.01 ? 'visible' : 'hidden';
    bt.el.style.transform = `translate3d(0, ${(1 - vis) * 24}px, 0)`;
    bt.el.classList.toggle('is-on', vis > 0.5);
    if (bt.words) {
      const local = Math.min(1, Math.max(0, (p - bt.a) / (span * 0.55)));
      const shown = Math.round(local * bt.words.length);
      bt.words.forEach((w, i) => { w.classList.toggle('is-shown', i < shown); w.classList.toggle('is-new', i < shown && i >= shown - 2 && local < 1); });
    }
  }
}

// ------------------------------------------------------------------------------------------ main
async function main() {
  const loader = document.querySelector<HTMLElement>('[data-loader]')!;
  const bar = loader.querySelector<HTMLElement>('[data-progress]')!;
  const gate = document.querySelector<HTMLElement>('[data-gate]')!;
  const canvas = document.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const soundBtn = document.querySelector<HTMLButtonElement>('[data-sound]')!;
  const header = document.querySelector<HTMLElement>('[data-hdr]');

  let progress = 0;
  const setProgress = (x: number) => { progress = Math.max(progress, x); bar.style.transform = `scaleX(${progress})`; };
  setProgress(0.1);

  const { webglAvailable } = await import('./scene');
  const staticMode = reduced || !webglAvailable();
  if (staticMode) root.classList.add('story-static');

  // data + fonts in parallel with the scene
  const playersP = loadPlayers().then(p => { setProgress(0.55); return p; });
  // never wait more than 3s on web fonts: the fallback faces are fine
  const fontsP = Promise.race([
    (document as any).fonts?.ready?.then(() => setProgress(0.4)) ?? Promise.resolve(),
    new Promise(r => setTimeout(r, 3000)),
  ]);

  let scene: Awaited<ReturnType<typeof import('./scene')['createScene']>> | null = null;
  if (!staticMode) {
    try {
      const mod = await import('./scene');
      scene = mod.createScene(canvas);
      scene.render(toPose(poseAt(0)));
    } catch (e) {
      console.warn('WebGL scene failed, using the static story', e);
      root.classList.add('story-static');
    }
  }
  setProgress(0.8);
  const players = await playersP.catch(() => []);
  await fontsP;
  setProgress(1);

  const leagueHref = (name: string) => `?q=${encodeURIComponent(name)}#league`;
  const car = document.querySelector<HTMLElement>('[data-carousel]');
  if (car && players.length) mountCarousel(car, players, leagueHref);

  // ---- Lenis smooth scroll driving ScrollTrigger
  const lenis = reduced ? null : new Lenis({ duration: 1.15, smoothWheel: true });
  if (lenis) {
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    lenis.stop();
  }

  // ---- loader out
  await new Promise(r => setTimeout(r, reduced ? 0 : 500));
  loader.classList.add('is-done');
  setTimeout(() => loader.remove(), 900);

  // ---- gate
  const sound = soundBtn;
  const setSoundUi = (onOff: boolean) => { sound.setAttribute('aria-pressed', String(onOff)); sound.querySelector('.sr-only')!.textContent = onOff ? 'Sound on' : 'Sound off'; };
  sound.addEventListener('click', async () => { const v = !audio.on; await audio.set(v); setSoundUi(v); store.set('notturno-sound', v ? 'on' : 'off'); });
  setSoundUi(false);

  const passGate = async (withSound: boolean) => {
    store.set('notturno-sound', withSound ? 'on' : 'off');
    store.sset('notturno-gate', '1');
    if (withSound) { await audio.set(true); setSoundUi(true); }
    gate.classList.add('is-leaving');
    setTimeout(() => { gate.hidden = true; }, reduced ? 0 : 1000);
    root.classList.remove('gate-open');
    lenis?.start();
    document.getElementById('main')?.focus({ preventScroll: true });
  };
  const deepLink = location.hash || location.search;
  if (store.sget('notturno-gate') === '1' || deepLink) {
    gate.hidden = true; root.classList.remove('gate-open'); lenis?.start();
    // sound needs a fresh user gesture; leave it off and let the toggle restore it
  } else {
    gate.hidden = false;
    gate.querySelector<HTMLButtonElement>('[data-gate-choice="sound"]')!.addEventListener('click', () => passGate(true));
    gate.querySelector<HTMLButtonElement>('[data-gate-choice="silent"]')!.addEventListener('click', () => passGate(false));
    requestAnimationFrame(() => gate.classList.add('is-in'));
    gate.querySelector<HTMLButtonElement>('[data-gate-choice="silent"]')!.focus({ preventScroll: true });
  }
  if (location.hash) {
    const target = document.querySelector(location.hash);
    if (target) setTimeout(() => (lenis ? lenis.scrollTo(target as HTMLElement, { immediate: true }) : target.scrollIntoView()), 50);
  }

  if (root.classList.contains('story-static') || !scene) return;

  // ---- scroll story
  const beats = collectBeats();
  let p = 0, dirty = true, visible = true, swished = false, lastMove = 0, lastDribble = 0;
  ScrollTrigger.create({
    trigger: '#story', start: 'top top', end: 'bottom bottom',
    onUpdate: self => { p = self.progress; dirty = true; lastMove = performance.now(); },
    onToggle: self => { visible = self.isActive || self.progress < 1; },
  });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(document.querySelector('#story')!);
  addEventListener('resize', () => { scene!.resize(); dirty = true; });
  document.addEventListener('visibilitychange', () => { dirty = true; });

  const loop = () => {
    requestAnimationFrame(loop);
    if (document.hidden || !visible) return;
    const pose = poseAt(p);
    scene!.render(toPose(pose)); // renders every frame while visible (the ball floats)
    // the walker dribbles while you scroll him forward
    const now = performance.now();
    if (audio.on && pose.walk > 0.5 && now - lastMove < 250 && now - lastDribble > 480) { audio.dribble(); lastDribble = now; }
    if (dirty) {
      paintBeats(beats, p);
      root.style.setProperty('--story-night', pose.night.toFixed(3));
      document.body.classList.toggle('paper-zone', pose.night < 0.5 && p < 1);
      header?.style.setProperty('--hdr-bg', pose.night < 0.5 ? '0' : '1');
      if (!swished && p > 0.72) { swished = true; audio.swish(); }
      if (p < 0.6) swished = false;
      dirty = false;
    }
  };
  loop();
}

/** three.js is loaded lazily, so hand the scene plain {x,y,z} objects; Vector3.copy / lookAt accept them. */
function toPose(k: ReturnType<typeof poseAt>) {
  const v = (a: V3) => ({ x: a[0], y: a[1], z: a[2], isVector3: true });
  return { ...k, pos: v(k.pos), look: v(k.look) } as any;
}

(window as any).__storyReady = true;
root.classList.add('gate-open');
main().catch(err => {
  console.error(err);
  root.classList.add('story-static');
  root.classList.remove('gate-open');
  document.querySelector('[data-loader]')?.remove();
  const g = document.querySelector<HTMLElement>('[data-gate]'); if (g) g.hidden = true;
});
