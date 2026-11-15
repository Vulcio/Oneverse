import type { GrooveDrum } from "@oneverse/core";

/**
 * A small drum kit made on the device (issue #105), like the metronome's
 * clicks: nothing to download, so grooves play offline. Each drum is drawn
 * once per audio context into a buffer; a hit is that buffer at its
 * velocity's loudness.
 */

interface Shape {
  length: number;
  render: (t: number, noise: number) => number;
}

/** A one-pole high-pass, for noise that should sound like metal rather than wind. */
function highPassed(cutoff: number, rate: number) {
  const a = 1 / (1 + (2 * Math.PI * cutoff) / rate);
  let lastIn = 0;
  let lastOut = 0;
  return (x: number) => {
    lastOut = a * (lastOut + x - lastIn);
    lastIn = x;
    return lastOut;
  };
}

const sweep = (t: number, from: number, to: number, time: number) => to + (from - to) * Math.exp(-t / time);

function shapes(rate: number): Record<GrooveDrum, Shape> {
  const phase = () => {
    let at = 0;
    return (frequency: number) => {
      at += (2 * Math.PI * frequency) / rate;
      return Math.sin(at);
    };
  };
  const tom = (from: number, to: number, length: number): Shape => {
    const osc = phase();
    return { length, render: (t) => osc(sweep(t, from, to, 0.08)) * Math.exp(-t / (length / 4)) * 0.8 };
  };
  const kick = phase();
  const snareTone = phase();
  const rimTone = phase();
  const hat = highPassed(7000, rate);
  const open = highPassed(6500, rate);
  const ride = highPassed(5000, rate);
  const rideBell = phase();
  const crash = highPassed(4000, rate);
  const snareNoise = highPassed(1500, rate);
  return {
    kick: { length: 0.45, render: (t) => kick(sweep(t, 150, 45, 0.035)) * Math.exp(-t / 0.13) * 1.1 },
    snare: { length: 0.25, render: (t, n) => snareNoise(n) * Math.exp(-t / 0.055) * 0.9 + snareTone(sweep(t, 230, 180, 0.02)) * Math.exp(-t / 0.035) * 0.5 },
    rim: { length: 0.06, render: (t, n) => (rimTone(1750) * 0.6 + n * 0.3) * Math.exp(-t / 0.009) },
    hihat: { length: 0.08, render: (t, n) => hat(n) * Math.exp(-t / 0.014) * 0.55 },
    openHihat: { length: 0.45, render: (t, n) => open(n) * Math.exp(-t / 0.11) * 0.45 },
    ride: { length: 0.9, render: (t, n) => (ride(n) * 0.25 + rideBell(3150) * 0.06) * Math.exp(-t / 0.28) },
    crash: { length: 1.6, render: (t, n) => crash(n) * Math.exp(-t / 0.45) * 0.55 },
    tomHigh: tom(260, 170, 0.35),
    tomLow: tom(150, 95, 0.45),
  };
}

/** Each drum's buffer, drawn for this audio context. */
export function makeDrumBuffers(ctx: BaseAudioContext): Map<GrooveDrum, AudioBuffer> {
  const rate = ctx.sampleRate;
  const made = new Map<GrooveDrum, AudioBuffer>();
  // The same noise every time: a kit that sounds the same on every device.
  let seed = 0x2545f491;
  const noise = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) / 0xffffffff) * 2 - 1;
  };
  for (const [drum, shape] of Object.entries(shapes(rate)) as [GrooveDrum, Shape][]) {
    const buffer = ctx.createBuffer(1, Math.ceil(shape.length * rate), rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / rate;
      // A fraction of a millisecond's attack, and to nothing at the end: no clicks.
      const edges = Math.min(1, t / 0.0005) * Math.min(1, (data.length - i) / (rate * 0.005));
      data[i] = shape.render(t, noise()) * edges * 0.7;
    }
    made.set(drum, buffer);
  }
  return made;
}

/** A hit's loudness from its MIDI velocity: a ghost note well under a hit. */
export const drumGain = (velocity: number) => Math.pow(Math.min(127, Math.max(1, velocity)) / 127, 1.6);
