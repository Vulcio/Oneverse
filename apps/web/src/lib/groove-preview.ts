import { grooveHits, secondsPerBeat, type GroovePatternRows, type GrooveStyle } from "@oneverse/core";
import { useSyncExternalStore } from "react";
import { drumGain, makeDrumBuffers } from "#/lib/drum-kit";

/**
 * A groove heard on its own, looping, while one is chosen (issue #105): the
 * editor's Drum groove panel. Its own audio, apart from the metronome's, so a
 * preview never moves the song's timeline.
 */

let ctx: AudioContext | null = null;
let kit: ReturnType<typeof makeDrumBuffers> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let sources: AudioBufferSourceNode[] = [];
let playing: string | null = null;
const listeners = new Set<() => void>();

function emit(next: string | null) {
  playing = next;
  for (const listener of listeners) listener();
}

/** Loops a pattern at a tempo; `id` says which (shown as playing) - again stops it. */
export function toggleGroovePreview(id: string, style: GrooveStyle, rows: GroovePatternRows, tempo: number) {
  const again = playing === id;
  stopGroovePreview();
  if (again) return;
  ctx ??= new AudioContext({ latencyHint: "interactive" });
  kit ??= makeDrumBuffers(ctx);
  const audio = ctx;
  void audio.resume();
  const beats = style.timeSignature.numerator;
  const barSeconds = beats * secondsPerBeat({ tempo, numerator: beats, denominator: style.timeSignature.denominator });
  const hits = grooveHits(rows, style.steps);
  let barStart = audio.currentTime + 0.08;
  const fill = () => {
    while (barStart < audio.currentTime + 0.3) {
      for (const hit of hits) {
        const source = audio.createBufferSource();
        source.buffer = kit!.get(hit.drum)!;
        const gain = audio.createGain();
        gain.gain.value = drumGain(hit.velocity);
        source.connect(gain).connect(audio.destination);
        source.start(barStart + (hit.step * barSeconds) / style.steps);
        sources.push(source);
      }
      barStart += barSeconds;
    }
    sources = sources.slice(-200);
  };
  fill();
  timer = setInterval(fill, 50);
  emit(id);
}

export function stopGroovePreview() {
  if (timer) clearInterval(timer);
  timer = null;
  for (const source of sources) {
    try {
      source.stop();
    } catch {
      // Over already.
    }
  }
  sources = [];
  if (playing) emit(null);
}

/** Which preview plays, if any. */
export function useGroovePreview(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => playing,
    () => null,
  );
}
