import { describe, expect, it } from "vite-plus/test";
import { WAVEFORM_RATE, WaveformMeter, bytesToBase64, readWaveform, waveformPeakBetween, waveformSlices } from "../waveform/index.js";

describe("waveform (issue #388)", () => {
  it("measures the loudest sample of each slice, across channels, against the loudest", () => {
    const rate = 1000;
    const meter = new WaveformMeter(rate, 2, 20);
    // One second, stereo: quiet, then loud on the right only from 0.5 s, cut into uneven chunks.
    const samples = new Int16Array(rate * 2);
    for (let frame = 0; frame < rate; frame++) {
      samples[frame * 2] = frame % 2 ? 1000 : -1000;
      samples[frame * 2 + 1] = frame >= 500 ? -16384 : 0;
    }
    meter.add(samples.subarray(0, 333 * 2));
    meter.add(samples.subarray(333 * 2));
    const waveform = meter.finish();
    expect(waveform.rate).toBe(20);
    expect(waveform.seconds).toBe(1);
    expect(waveform.peaks.length).toBe(20);
    expect(waveform.loudest).toBeCloseTo(0.5);
    expect([...waveform.peaks.slice(0, 10)]).toEqual(new Array(10).fill(16));
    expect([...waveform.peaks.slice(10)]).toEqual(new Array(10).fill(255));
  });

  it("keeps a last, shorter slice and reads silence as zero", () => {
    const meter = new WaveformMeter(1000, 1);
    expect(WAVEFORM_RATE).toBe(100);
    meter.add(new Int16Array(225));
    const waveform = meter.finish();
    expect(waveform.peaks.length).toBe(23);
    expect(waveform.rate).toBe(100);
    expect(waveform.loudest).toBe(0);
    expect(waveform.seconds).toBeCloseTo(0.225);
  });

  it("comes back from base64 as levels, and is read between times", () => {
    const wire = { rate: 20, seconds: 0.2, loudest: 0.5, peaks: bytesToBase64(Uint8Array.from([0, 51, 255, 102])) };
    const read = readWaveform(wire)!;
    expect([...read.levels].map((level) => Math.round(level * 100))).toEqual([0, 20, 100, 40]);
    expect(waveformPeakBetween(read.levels, 20, 0, 0.06)).toBeCloseTo(0.2);
    expect(waveformPeakBetween(read.levels, 20, 0.15, 1)).toBeCloseTo(0.4);
    expect(waveformSlices(read.levels, 2).map((level) => Math.round(level * 100))).toEqual([20, 100]);
    expect(readWaveform({ rate: 20, seconds: 1, loudest: 1, peaks: "" })).toBeNull();
  });
});
