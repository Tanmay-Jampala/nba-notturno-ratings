/** Original sound, synthesised live with Web Audio: a low arena hum and a net swish. No audio files. */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let on = false;

function noiseBuffer(c: AudioContext, seconds: number, brown = false) {
  const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}

function build() {
  ctx = new AudioContext();
  master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  const hum = ctx.createGain(); hum.gain.value = 0.5; hum.connect(master);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240; lp.connect(hum);
  for (const [f, g] of [[55, 0.12], [82.4, 0.07], [110.2, 0.03]] as const) {
    const o = ctx.createOscillator(); o.frequency.value = f; o.detune.value = Math.random() * 8 - 4;
    const og = ctx.createGain(); og.gain.value = g; o.connect(og).connect(lp); o.start();
  }
  const crowd = ctx.createBufferSource(); crowd.buffer = noiseBuffer(ctx, 4, true); crowd.loop = true;
  const cg = ctx.createGain(); cg.gain.value = 0.35; crowd.connect(cg).connect(lp); crowd.start();
}

export const audio = {
  get on() { return on; },
  async set(v: boolean) {
    on = v;
    if (v && !ctx) build();
    if (!ctx || !master) return;
    if (ctx.state === 'suspended') await ctx.resume();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(v ? 0.18 : 0, ctx.currentTime, 0.4);
  },
  swish() {
    if (!on || !ctx || !master) return;
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.6);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(5200, ctx.currentTime); bp.frequency.exponentialRampToValueAtTime(1800, ctx.currentTime + 0.45);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 0.04); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    src.connect(bp).connect(g).connect(master); src.start(); src.stop(ctx.currentTime + 0.6);
  },
};
