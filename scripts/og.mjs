// Render share cards (1200×630) for the home page and all 30 team pages into public/og/.
// Cards hold names and colours only (no ratings), so they don't need regenerating on data updates.
//   node scripts/og.mjs            (uses an installed Edge/Chrome via Playwright)
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const teams = JSON.parse(readFileSync(new URL('../config/teams.json', import.meta.url), 'utf-8'));
const out = new URL('../public/og/', import.meta.url);
mkdirSync(out, { recursive: true });

const emblem = `<svg width="64" height="64" viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="1.6"><circle cx="50" cy="50" r="48"/><circle cx="50" cy="50" r="43"/><path d="M50 2V98M2 50H98M20 12C40 32 40 68 20 88M80 12C60 32 60 68 80 88"/><circle cx="50" cy="50" r="17" fill="#1d1d1d"/><circle cx="50" cy="50" r="7.5"/></svg>`;
const card = ({ lines, ghost = '', color = '#c82924', foot }) => `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Allura&family=Limelight&family=M+PLUS+Rounded+1c:wght@800&display=block" rel="stylesheet">
<style>
  *{margin:0;box-sizing:border-box} body{width:1200px;height:630px;background:#1d1d1d;color:#fff;position:relative;overflow:hidden;font-family:Limelight}
  .ghost{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);font-size:470px;line-height:.8;color:${color};opacity:.13;white-space:nowrap}
  .brand{position:absolute;top:44px;left:56px;display:flex;align-items:center;gap:14px;font:400 46px/1 Allura}
  .h{position:absolute;left:0;right:0;top:50%;transform:translateY(-46%);text-align:center;text-transform:uppercase;font-size:104px;line-height:1.02}
  .rule{position:absolute;left:50%;bottom:118px;width:260px;height:2px;margin-left:-130px;background:${color}}
  .foot{position:absolute;left:0;right:0;bottom:62px;text-align:center;font:800 18px/1 'M PLUS Rounded 1c';letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.7)}
  .frame{position:absolute;inset:22px;border:3px solid rgba(255,255,255,.85)}
</style></head><body>
<div class="frame"></div><div class="ghost">${ghost}</div>
<div class="brand">${emblem}<span>Notturno</span></div>
<div class="h">${lines.map(l => `<div>${l}</div>`).join('')}</div>
<div class="rule"></div><div class="foot">${foot}</div></body></html>`;

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
const shoot = async (name, html) => {
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, out)) });
  console.log('✓', name);
};
await shoot('default', card({ lines: ['Rated for the faithful,', 'ranked for the doubters'], foot: 'Every NBA player · 2026-27 · rated out of 100' }));
for (const t of teams) {
  const long = (t.city + t.name).length > 22 && t.name.includes(' ');
  const lines = long ? [t.city + ' ' + t.name.split(' ')[0], t.name.split(' ').slice(1).join(' ')] : [t.city, t.name];
  await shoot(t.abbr.toLowerCase(), card({ lines, ghost: t.abbr, color: t.color === '#FFFFFF' ? '#9a9a9a' : t.color, foot: `${t.conference}ern Conference · 15 players rated out of 100 · 2026-27` }));
}
await browser.close();
