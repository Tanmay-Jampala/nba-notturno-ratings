/**
 * Original sound, synthesised live with Web Audio (no audio files):
 *   - arena ambience: a crowd murmur (band-passed noise that slowly swells) over a warm two-note pad
 *   - one-shots: a dribble (pitched thump + floor click) and a net swish
 * Everything sits in the 150 Hz – 6 kHz range so laptop and phone speakers can actually play it.
 * (The first version was a 55–110 Hz hum: inaudible on small speakers.)
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let on = false;
const MASTER_ON = 0.85;

function noiseBuffer(c: BaseAudioContext, seconds: number, pink = false) {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (pink) { // Paul Kellet's economy pink filter
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    } else d[i] = w;
  }
  return buf;
}

/** Build the looping ambience into `dest`. Exported so it can be rendered offline to check levels. */
export function buildAmbience(c: BaseAudioContext, dest: AudioNode) {
  // crowd murmur: pink noise through a 450 Hz – 2.4 kHz band, swelling on a slow LFO
  const crowd = c.createBufferSource(); crowd.buffer = noiseBuffer(c, 6, true); crowd.loop = true;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 450;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
  const crowdGain = c.createGain(); crowdGain.gain.value = 0.32;
  const lfo = c.createOscillator(); lfo.frequency.value = 0.09;
  const lfoDepth = c.createGain(); lfoDepth.gain.value = 0.12;
  lfo.connect(lfoDepth).connect(crowdGain.gain);
  crowd.connect(hp).connect(lp).connect(crowdGain).connect(dest);
  crowd.start(); lfo.start();

  // warm pad: A2 + E3 sawtooths, low-passed so only soft harmonics remain
  const padLp = c.createBiquadFilter(); padLp.type = 'lowpass'; padLp.frequency.value = 900; padLp.Q.value = 0.5;
  const pad = c.createGain(); pad.gain.value = 0.05;
  padLp.connect(pad).connect(dest);
  for (const f of [110, 110.6, 164.8, 165.5]) {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(padLp); o.start();
  }
}

function build() {
  ctx = new AudioContext();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
  master = ctx.createGain(); master.gain.value = 0;
  master.connect(comp).connect(ctx.destination);
  buildAmbience(ctx, master);
}

function dribble(c: AudioContext, dest: AudioNode, at = c.currentTime) {
  // body: a sine that drops in pitch (the ball's thump), plus harmonics so small speakers hear it
  const o = c.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(240, at); o.frequency.exponentialRampToValueAtTime(90, at + 0.09);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.9, at + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
  o.connect(g).connect(dest); o.start(at); o.stop(at + 0.18);
  // slap: a short burst of band-passed noise (the ball meeting the hardwood)
  const n = c.createBufferSource(); n.buffer = noiseBuffer(c, 0.05);
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 1.2;
  const ng = c.createGain(); ng.gain.setValueAtTime(0.5, at); ng.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
  n.connect(bp).connect(ng).connect(dest); n.start(at); n.stop(at + 0.05);
}

function swish(c: AudioContext, dest: AudioNode, at = c.currentTime) {
  const src = c.createBufferSource(); src.buffer = noiseBuffer(c, 0.6);
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(5200, at); bp.frequency.exponentialRampToValueAtTime(1800, at + 0.45);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(0.9, at + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
  src.connect(bp).connect(g).connect(dest); src.start(at); src.stop(at + 0.6);
}

export const audio = {
  get on() { return on; },
  /** Must be called from a user gesture (click / keypress) the first time, or browsers keep it muted. */
  async set(v: boolean) {
    on = v;
    if (v && !ctx) build();
    if (!ctx || !master) return;
    if (v && ctx.state !== 'running') await ctx.resume();
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.setTargetAtTime(v ? MASTER_ON : 0, t, v ? 0.35 : 0.15);
    if (v) {
      // immediate confirmation: two dribbles and a swish
      dribble(ctx, master, t + 0.05); dribble(ctx, master, t + 0.5); swish(ctx, master, t + 0.95);
    } else {
      setTimeout(() => { if (!on && ctx?.state === 'running') ctx.suspend(); }, 900); // stop burning CPU when muted
    }
  },
  swish() { if (on && ctx && master) swish(ctx, master); },
  dribble() { if (on && ctx && master) dribble(ctx, master); },
  get state() { return ctx?.state ?? 'none'; },
};
