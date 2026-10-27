import { reactionLevel, SCREEN_EFFECT_TARGETS, SCREEN_REACTION_FALL_MS, type ScreenTheme } from "@oneverse/core";
import { useEffect, useRef, type RefObject } from "react";
import { screenDrawStats } from "./screen-draw-stats";

type Target = (typeof SCREEN_EFFECT_TARGETS)[number];

/** How fast a level follows its reactions, in ms: up quickly, down a little more gently (frame rate aside). */
const FOLLOW_UP_MS = 28;
const FOLLOW_DOWN_MS = 130;
/** Between lines, and between words, when the words don't come in piece by piece. */
const LINE_GAP_MS = 320;
const WORD_GAP_MS = 140;
/** The most kicks a slide's words set off: a long slide doesn't keep the background busy. */
const MAX_KICKS = 24;

/**
 * Effects on a screen (issue #281): the background answering the words. Each
 * reaction is set off by a slide coming, a line or a word appearing, a new
 * section, or a chorus (while it lasts), and drives one of the background's
 * inputs - a pulse of light, its movement, hue, brightness, elements, a
 * shader's rotation or scale - by its amount times how much the background
 * answers (`reacts`), rising and falling back over its own times (issue
 * #324, `reactionLevel`). The levels
 * are written as CSS variables on the stage (`--react-<target>`, 0 to 1),
 * frame by frame, without rendering React again; the stage's CSS turns them
 * into light, motion and colour. Nothing runs without reactions, or for
 * someone who asked for less motion.
 */
export function useScreenEffects(
  stage: RefObject<HTMLElement | null>,
  theme: ScreenTheme,
  now: { viewKey: string; sectionKey: string; chorus: boolean; lines: string[] },
): RefObject<ScreenSignals> {
  const reactions = theme.effects?.reactions ?? [];
  // The levels, for a background drawn on a canvas (issue #296) to read each frame too.
  const signals = useRef<ScreenSignals>({ levels: Object.fromEntries(SCREEN_EFFECT_TARGETS.map((target) => [target, 0])) as ScreenSignals["levels"] });
  const kicks = useRef<{ target: Target; level: number; at: number; rise?: number; fall?: number }[]>([]);
  const sustained = useRef<Partial<Record<Target, number>>>({});
  const strength = (target: Target, amount: number) => amount * (target === "pulse" ? 1 : theme.reacts[target]);
  const active = reactions.length > 0;

  // What sets them off: the slide, its lines and words, the section.
  useEffect(() => {
    if (!active) return;
    const at = performance.now();
    const words = now.lines.join(" ").split(/\s+/).filter(Boolean);
    const { reveal, stagger } = theme.motion;
    const lineGap = reveal === "lines" ? Math.max(stagger, 120) : LINE_GAP_MS;
    const wordGap = reveal === "words" || reveal === "glow" ? Math.max(stagger, 60) : WORD_GAP_MS;
    for (const one of reactions) {
      const level = strength(one.target, one.amount);
      const times = { rise: one.rise, fall: one.fall };
      if (one.on === "slide") kicks.current.push({ target: one.target, level, at, ...times });
      if (one.on === "line") now.lines.slice(0, MAX_KICKS).forEach((_, i) => kicks.current.push({ target: one.target, level, at: at + i * lineGap, ...times }));
      if (one.on === "word") words.slice(0, MAX_KICKS).forEach((_, i) => kicks.current.push({ target: one.target, level: level * 0.7, at: at + i * wordGap, ...times }));
    }
  }, [now.viewKey, active]);
  useEffect(() => {
    if (!active) return;
    const at = performance.now();
    for (const one of reactions) if (one.on === "section") kicks.current.push({ target: one.target, level: strength(one.target, one.amount), at, rise: one.rise, fall: one.fall });
  }, [now.sectionKey, active]);
  // A chorus holds its reactions while it lasts.
  useEffect(() => {
    const held: Partial<Record<Target, number>> = {};
    if (now.chorus) for (const one of reactions) if (one.on === "chorus") held[one.target] = Math.max(held[one.target] ?? 0, strength(one.target, one.amount));
    sustained.current = held;
  }, [now.chorus, theme.effects, theme.reacts]);

  // Frame by frame: each input's level, the strongest kick still fading or what a chorus holds, eased towards.
  useEffect(() => {
    const element = stage.current;
    if (!element || !active || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const levels = signals.current.levels;
    screenDrawStats.effects = true;
    let frame = 0;
    let last = performance.now();
    const tick = () => {
      const time = performance.now();
      const dt = Math.min(100, time - last);
      last = time;
      kicks.current = kicks.current.filter((kick) => time - kick.at < (kick.rise ?? 0) + (kick.fall ?? SCREEN_REACTION_FALL_MS));
      for (const target of SCREEN_EFFECT_TARGETS) {
        let goal = sustained.current[target] ?? 0;
        for (const kick of kicks.current) {
          if (kick.target !== target || kick.at > time) continue;
          goal = Math.max(goal, reactionLevel(time - kick.at, { amount: kick.level, rise: kick.rise, fall: kick.fall }));
        }
        // Up fast, down gently, the same on a 30 fps TV as on a 60 fps laptop.
        const follow = 1 - Math.exp(-dt / (goal > levels[target] ? FOLLOW_UP_MS : FOLLOW_DOWN_MS));
        levels[target] += (goal - levels[target]) * follow;
        element.style.setProperty(`--react-${target}`, levels[target].toFixed(3));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      screenDrawStats.effects = false;
      for (const target of SCREEN_EFFECT_TARGETS) {
        element.style.removeProperty(`--react-${target}`);
        levels[target] = 0;
      }
    };
  }, [active, stage]);
  return signals;
}

/** What effects have set off, now, for a background to answer: each input's level, 0 to 1. */
export interface ScreenSignals {
  levels: Record<Target, number>;
}
