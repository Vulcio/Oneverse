import { SHADER_CONTROLS, SHADER_SCREEN_INPUTS, isShaderControl, type ShaderControl } from "./shader-spec.js";

/**
 * ISF shaders (issue #297): backgrounds written as an Interactive Shader
 * Format fragment shader - GLSL with a JSON header declaring its inputs
 * (https://github.com/mrRay/ISF_Spec). Reading the header is shared by
 * every client: the editor builds a control for each input, a screen gives
 * each its value, and the API checks an uploaded shader before keeping it.
 *
 * Inputs named by the shader spec (issue #324, shader-spec.ts) are of two
 * kinds: standard controls (`sv_brightness`, `sv_rotation`…), shown under
 * the same label for every shader and pushed by effects, their range and
 * default the spec's unless the header gives its own; and the inputs a
 * screen fills itself (`sv_color1`…, `sv_pulse`, `sv_words`…), never shown.
 */

export const ISF_INPUT_TYPES = ["float", "bool", "long", "color", "point2D", "image", "event", "audio", "audioFFT"] as const;
export type IsfInputType = (typeof ISF_INPUT_TYPES)[number];

/** The largest shader source taken, in characters. */
export const ISF_MAX_SOURCE = 64 * 1024;

/** The inputs a screen fills itself. */
export const ISF_SONGVERSE_INPUTS = SHADER_SCREEN_INPUTS;

export interface IsfInput {
  name: string;
  type: IsfInputType;
  label: string | null;
  min: number | null;
  max: number | null;
  /** A float's or long's number, a bool's boolean, a colour's [r, g, b, a] (0-1), a point's [x, y]; null for an image, an event or sound. */
  default: number | boolean | number[] | null;
  /** A long's choices: their values and labels. */
  values: number[];
  labels: string[];
  /** Filled by the screen (an `sv_` input), not a control. */
  songverse: boolean;
  /** A standard control of the shader spec: shown under its own label, pushed by effects. */
  standard: boolean;
}

export interface IsfShader {
  description: string | null;
  credit: string | null;
  categories: string[];
  inputs: IsfInput[];
  /** The GLSL after the header. */
  body: string;
}

export type IsfValue = number | boolean | number[];

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const text = (value: unknown, max = 500): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
const vector = (value: unknown, length: number): number[] | null =>
  Array.isArray(value) && value.length >= length && value.slice(0, length).every((one) => num(one) !== null) ? (value.slice(0, length) as number[]) : null;

/**
 * An ISF shader's header and body, or why it can't be used: no header, a
 * header that isn't JSON, an input without a name or of an unknown type, two
 * inputs of one name, more than one pass (not drawn yet), or too long.
 * Never throws.
 */
export function readIsf(source: unknown): IsfShader | { error: string } {
  if (typeof source !== "string" || !source.trim()) return { error: "The shader is empty" };
  if (source.length > ISF_MAX_SOURCE) return { error: `The shader is longer than ${ISF_MAX_SOURCE / 1024} KB` };
  const match = /^\s*\/\*\s*(\{[\s\S]*?\})\s*\*\//.exec(source);
  if (!match) return { error: "The shader has no ISF header: a JSON object in a /* */ comment at its start" };
  let header: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(match[1]!);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: "The ISF header is not a JSON object" };
    header = parsed as Record<string, unknown>;
  } catch {
    return { error: "The ISF header is not valid JSON" };
  }
  const passes = header.PASSES;
  if (Array.isArray(passes) && passes.length > 1) return { error: "Shaders with several passes aren't drawn yet" };
  const raw = header.INPUTS === undefined ? [] : header.INPUTS;
  if (!Array.isArray(raw)) return { error: "INPUTS must be a list" };
  const inputs: IsfInput[] = [];
  for (const one of raw.slice(0, 40)) {
    if (!one || typeof one !== "object") return { error: "Each input must be an object" };
    const input = one as Record<string, unknown>;
    const name = input.NAME;
    if (typeof name !== "string" || !NAME.test(name)) return { error: `An input's NAME must be a GLSL name: ${JSON.stringify(name)}` };
    if (inputs.some((other) => other.name === name)) return { error: `Two inputs are named ${name}` };
    const type = input.TYPE;
    if (!(ISF_INPUT_TYPES as readonly unknown[]).includes(type)) return { error: `${name}'s TYPE isn't one ISF knows: ${JSON.stringify(type)}` };
    inputs.push(readInput(name, type as IsfInputType, input));
  }
  return {
    description: text(header.DESCRIPTION),
    credit: text(header.CREDIT, 200),
    categories: Array.isArray(header.CATEGORIES) ? header.CATEGORIES.flatMap((one) => (text(one, 40) ? [text(one, 40)!] : [])).slice(0, 10) : [],
    inputs,
    body: source.slice(match[0].length),
  };
}

function readInput(name: string, type: IsfInputType, input: Record<string, unknown>): IsfInput {
  const label = text(input.LABEL, 60);
  const songverse = (ISF_SONGVERSE_INPUTS as readonly string[]).includes(name);
  // A standard control of another type than the spec's is the shader's own.
  const spec: ShaderControl | null = isShaderControl(name) && SHADER_CONTROLS[name].type === type ? SHADER_CONTROLS[name] : null;
  const base = { name, type, label, min: null, max: null, default: null, values: [], labels: [], songverse, standard: spec !== null };
  if (type === "float") {
    const min = num(input.MIN) ?? spec?.min ?? 0;
    const max = Math.max(min, num(input.MAX) ?? spec?.max ?? 1);
    return { ...base, min, max, default: clamp(num(input.DEFAULT) ?? (spec ? (spec.default as number) : min), min, max) };
  }
  if (type === "long") {
    const values = Array.isArray(input.VALUES) ? input.VALUES.flatMap((one) => (num(one) === null ? [] : [Math.round(one as number)])).slice(0, 20) : [];
    const labels = Array.isArray(input.LABELS) ? input.LABELS.map((one) => text(one, 40) ?? "").slice(0, values.length) : [];
    const min = values.length ? Math.min(...values) : Math.round(num(input.MIN) ?? 0);
    const max = values.length ? Math.max(...values) : Math.max(min, Math.round(num(input.MAX) ?? min));
    return { ...base, min, max, values, labels, default: Math.round(clamp(num(input.DEFAULT) ?? values[0] ?? min, min, max)) };
  }
  if (type === "bool") return { ...base, default: input.DEFAULT === true || input.DEFAULT === 1 };
  if (type === "color") return { ...base, default: (vector(input.DEFAULT, 4) ?? [0, 0, 0, 1]).map((one) => clamp(one, 0, 1)) };
  if (type === "point2D") return { ...base, default: vector(input.DEFAULT, 2) ?? (spec ? (spec.default as number[]) : [0, 0]), min: spec?.min ?? null, max: spec?.max ?? null };
  return base;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The values a screen gives a shader's inputs (the controls', not the
 * screen's own `sv_` ones): those saved, kept in range, else the input's
 * default; a value of the wrong kind, or for an input the shader no longer
 * has, is left out.
 */
export function readIsfValues(inputs: IsfInput[], values: unknown): Record<string, IsfValue> {
  const saved = values && typeof values === "object" && !Array.isArray(values) ? (values as Record<string, unknown>) : {};
  const out: Record<string, IsfValue> = {};
  for (const input of inputs) {
    if (input.songverse || input.default === null) continue;
    const value = saved[input.name];
    if (input.type === "float" || input.type === "long") {
      const n = num(value);
      out[input.name] = n === null ? (input.default as number) : clamp(input.type === "long" ? Math.round(n) : n, input.min ?? n, input.max ?? n);
      if (input.type === "long" && input.values.length && !input.values.includes(out[input.name] as number)) out[input.name] = input.default as number;
    } else if (input.type === "bool") out[input.name] = typeof value === "boolean" ? value : (input.default as boolean);
    else if (input.type === "color") out[input.name] = (vector(value, 4) ?? (input.default as number[])).map((one) => clamp(one, 0, 1));
    else if (input.type === "point2D") out[input.name] = vector(value, 2) ?? (input.default as number[]);
  }
  return out;
}
