/**
 * Built-in ISF shaders (issues #297, #324), written for Oneverse's screens
 * to the shader spec (docs/screen-shader-spec.md): each draws in the
 * background theme's colours, takes the standard controls it has (its look,
 * where its pattern is), answers effects (`sv_pulse`, and the standard
 * controls they push), draws less at a lower `sv_quality`, and keeps clear
 * of the words (`sv_words`). Their own other inputs are the controls the
 * background editor shows after the standard ones. One pass, compiled for
 * WebGL 2. Their names are in the locale files
 * (`screens.editor.shaders.<id>`).
 *
 * "Paper mesh gradient" and "Neuro noise" are ported from Paper Shaders
 * (https://github.com/paper-design/shaders, Apache-2.0, Copyright 2026
 * Paper; licence and notice in packages/core/licenses/).
 */

const color = (n: number, rgba: number[]) => `{ "NAME": "sv_color${n}", "TYPE": "color", "DEFAULT": [${rgba.join(", ")}] }`;
/** The theme's colours, how many there are, the pulse and where the words are: filled by the screen. */
const SCREEN = (colors: number) =>
  [
    ...Array.from({ length: colors }, (_, i) => color(i + 1, [[0.02, 0.01, 0.06, 1], [0.43, 0.16, 0.85, 1], [0.86, 0.15, 0.47, 1], [0.05, 0.65, 0.91, 1]][i % 4]!)),
    `{ "NAME": "sv_colors", "TYPE": "float" }`,
    `{ "NAME": "sv_pulse", "TYPE": "float" }`,
    `{ "NAME": "sv_words", "TYPE": "image" }`,
  ].join(",\n    ");
/** The look: brightness, contrast, saturation, colour shift, grain. */
const LOOK = (grain: number) =>
  [
    `{ "NAME": "sv_brightness", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.5 }`,
    `{ "NAME": "sv_contrast", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.5 }`,
    `{ "NAME": "sv_saturation", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.5 }`,
    `{ "NAME": "sv_hue", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 }`,
    `{ "NAME": "sv_grain", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": ${grain} }`,
  ].join(",\n    ");
/** Where its pattern is: turned, scaled, moved. */
const PLACE = [
  `{ "NAME": "sv_rotation", "TYPE": "float", "MIN": -180, "MAX": 180, "DEFAULT": 0 }`,
  `{ "NAME": "sv_scale", "TYPE": "float", "MIN": 0.25, "MAX": 4, "DEFAULT": 1 }`,
  `{ "NAME": "sv_offset", "TYPE": "point2D", "DEFAULT": [0, 0] }`,
].join(",\n    ");

const COMMON = `
vec3 svHueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
float svHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;
/** The look applied to a colour: 0.5 is as drawn for brightness, contrast and saturation. */
const GRADE = `
vec3 svGrade(vec3 c) {
  c = svHueShift(c, sv_hue * 6.28318);
  c *= 0.5 + sv_brightness;
  c = (c - 0.5) * (0.5 + sv_contrast) + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, sv_saturation * 2.0);
}
vec3 svGrained(vec3 c, vec2 uv) {
  if (sv_quality < 0.5 || sv_grain <= 0.0) return c;
  return c + (svHash(uv * RENDERSIZE + fract(TIME)) - 0.5) * sv_grain * 0.15;
}
`;

const MESH_GRADIENT = `/*{
  "DESCRIPTION": "Soft colours slowly morphing into one another, a little darker behind the words.",
  "CREDIT": "Oneverse",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Oneverse"],
  "INPUTS": [
    { "NAME": "sv_softness", "TYPE": "float", "MIN": 0.15, "MAX": 1, "DEFAULT": 0.55 },
    { "NAME": "sv_size", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.5 },
    ${LOOK(0.2)},
    ${PLACE},
    { "NAME": "shade", "LABEL": "Shade behind the words", "TYPE": "float", "MIN": 0, "MAX": 0.8, "DEFAULT": 0.3 },
    ${SCREEN(4)}
  ]
}*/
${COMMON}${GRADE}
void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = svPlace(uv);
  float t = TIME * 0.35;
  vec2 a = vec2(aspect * 0.38 * sin(t * 0.31), 0.36 * cos(t * 0.27));
  vec2 b = vec2(aspect * 0.40 * cos(t * 0.23 + 1.7), 0.38 * sin(t * 0.37 + 0.4));
  vec2 c = vec2(aspect * 0.36 * sin(t * 0.19 + 3.1), 0.40 * cos(t * 0.29 + 2.2));
  float s = sv_softness * sv_softness * max(0.1, 0.5 + 1.2 * (sv_size - 0.5));
  float wa = exp(-pow(distance(p, a), 2.0) / s);
  float wb = exp(-pow(distance(p, b), 2.0) / s);
  float wc = exp(-pow(distance(p, c), 2.0) / s);
  float total = wa + wb + wc + 0.0001;
  vec3 light = (sv_color2.rgb * wa + sv_color3.rgb * wb + sv_color4.rgb * wc) / total;
  vec3 colour = mix(sv_color1.rgb, light, clamp(total, 0.0, 1.0));
  colour = svGrade(colour) * (1.0 + 0.4 * sv_pulse);
  colour *= 1.0 - shade * IMG_NORM_PIXEL(sv_words, uv).r;
  gl_FragColor = vec4(clamp(svGrained(colour, uv), 0.0, 1.0), 1.0);
}
`;

const GLOW_LINES = `/*{
  "DESCRIPTION": "Glowing lines waving across the screen, their colours split at the edges, quieter behind the words.",
  "CREDIT": "Oneverse",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Oneverse"],
  "INPUTS": [
    { "NAME": "count", "LABEL": "Lines", "TYPE": "float", "MIN": 1, "MAX": 8, "DEFAULT": 4 },
    { "NAME": "amplitude", "LABEL": "Height", "TYPE": "float", "MIN": 0, "MAX": 0.5, "DEFAULT": 0.16 },
    { "NAME": "frequency", "LABEL": "Waves", "TYPE": "float", "MIN": 0.5, "MAX": 6, "DEFAULT": 1.6 },
    { "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "MIN": 0.002, "MAX": 0.05, "DEFAULT": 0.012 },
    { "NAME": "split", "LABEL": "Colour split", "TYPE": "float", "MIN": 0, "MAX": 0.3, "DEFAULT": 0.06 },
    { "NAME": "quiet", "LABEL": "Quieter behind the words", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.75 },
    { "NAME": "sv_size", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.5 },
    ${LOOK(0)},
    ${PLACE},
    ${SCREEN(4)}
  ]
}*/
${COMMON}${GRADE}
float line(float x, float y, float t, float i, float amp) {
  float offset = (i - (count - 1.0) / 2.0) * 0.07;
  float wave = sin((x + t + i * 1.3) * frequency * 3.14159) * amp;
  return glow / abs(y - 0.5 - offset - wave);
}
void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = svPlace(uv);
  float x = p.x / aspect + 0.5;
  float y = p.y + 0.5;
  float t = TIME * 0.6;
  float amp = amplitude * max(0.0, 1.0 + 3.0 * (sv_size - 0.5) + sv_pulse);
  float d = split * (abs(x - 0.5) * 2.0);
  // Fewer lines, and no colour split, on a device that can't keep up.
  float lines = sv_quality < 0.5 ? min(count, 3.0) : count;
  vec3 colour = sv_color1.rgb;
  for (int n = 0; n < 8; n++) {
    float i = float(n);
    if (i >= lines) break;
    vec3 tint = mod(i, 3.0) < 1.0 ? sv_color2.rgb : mod(i, 3.0) < 2.0 ? sv_color3.rgb : sv_color4.rgb;
    float g = line(x, y, t, i, amp);
    float r = sv_quality < 0.5 ? g : line(x * (1.0 + d), y, t, i, amp);
    float b = sv_quality < 0.5 ? g : line(x * (1.0 - d), y, t, i, amp);
    colour += vec3(r * tint.r, g * tint.g, b * tint.b) * 0.6;
  }
  colour = svGrade(colour);
  colour = mix(colour, sv_color1.rgb, quiet * IMG_NORM_PIXEL(sv_words, uv).r);
  gl_FragColor = vec4(clamp(svGrained(colour, uv), 0.0, 1.0), 1.0);
}
`;

const EMBERS = `/*{
  "DESCRIPTION": "Soft points of light rising in depth, glimmering; they swell with the words.",
  "CREDIT": "Oneverse",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Oneverse"],
  "INPUTS": [
    { "NAME": "sv_density", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.45 },
    { "NAME": "sv_size", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.5 },
    { "NAME": "blur", "LABEL": "Blur", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.6 },
    { "NAME": "falling", "LABEL": "Falling", "TYPE": "bool", "DEFAULT": false },
    ${LOOK(0)},
    ${PLACE},
    ${SCREEN(4)}
  ]
}*/
${COMMON}${GRADE}
void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 p = svPlace(uv);
  float t = TIME * 0.35 * (falling ? -1.0 : 1.0);
  float size = 0.2 + sv_size * 1.6;
  // Fewer layers of depth on a device that can't keep up.
  int layers = sv_quality < 0.5 ? 2 : sv_quality < 1.5 ? 3 : 4;
  vec3 colour = sv_color1.rgb;
  for (int n = 0; n < 4; n++) {
    if (n >= layers) break;
    float layer = float(n);
    float scale = 5.0 + layer * 3.5;
    vec2 q = p * scale - vec2(0.0, t * (1.0 + layer * 0.35));
    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5;
    float seed = svHash(id + layer * 13.0);
    if (seed > sv_density) continue;
    vec2 centre = vec2(svHash(id + 1.7), svHash(id + 4.1)) - 0.5;
    float r = (0.08 + 0.14 * svHash(id + 3.1)) * size;
    float dist = length(f - centre * 0.6);
    float light = 1.0 - smoothstep(r * (1.0 - blur * 0.9), r, dist);
    float twinkle = 0.6 + 0.4 * sin(TIME * 2.0 + seed * 40.0);
    vec3 tint = mix(sv_color2.rgb, mix(sv_color3.rgb, sv_color4.rgb, svHash(id + 9.3)), svHash(id + 7.0));
    colour += tint * light * twinkle * (1.0 / (1.0 + layer * 0.6)) * (0.7 + 0.4 * sv_pulse);
  }
  colour = svGrade(colour);
  colour = mix(colour, sv_color1.rgb, 0.35 * IMG_NORM_PIXEL(sv_words, uv).r);
  gl_FragColor = vec4(clamp(svGrained(colour, uv), 0.0, 1.0), 1.0);
}
`;

/** Paper Shaders' mesh gradient: every colour a point moving on its own path, blended by distance, warped and swirled. */
const PAPER_MESH = `/*{
  "DESCRIPTION": "Every colour of the theme flowing into the others, warped and swirled; darker behind the words.",
  "CREDIT": "Paper Shaders (https://github.com/paper-design/shaders), Apache-2.0; ported for Oneverse",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Oneverse", "Paper"],
  "INPUTS": [
    { "NAME": "sv_distortion", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.8 },
    { "NAME": "sv_swirl", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.1 },
    ${LOOK(0)},
    ${PLACE},
    { "NAME": "shade", "LABEL": "Shade behind the words", "TYPE": "float", "MIN": 0, "MAX": 0.8, "DEFAULT": 0.25 },
    ${SCREEN(8)}
  ]
}*/
${COMMON}${GRADE}
vec2 rotate(vec2 uv, float th) { return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv; }
float hash21(vec2 p) {
  p = fract(p * vec2(0.3183099, 0.3678794)) + 0.1;
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}
float valueNoise(vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
vec2 getPosition(int i, float t) {
  float a = float(i) * 0.37;
  float b = 0.6 + fract(float(i) / 3.0) * 0.9;
  float c = 0.8 + fract(float(i + 1) / 4.0);
  return 0.5 + 0.5 * vec2(sin(t * b + a), cos(t * c + a * 1.5));
}
void main() {
  vec2 screen = isf_FragNormCoord;
  vec2 uv = svPlace(screen) + 0.5;
  vec2 grainUV = uv * 1000.0;
  float t = 0.5 * (TIME + 41.5);
  float radius = smoothstep(0.0, 1.0, length(uv - 0.5));
  float center = 1.0 - radius;
  // One pass of warping instead of two on a device that can't keep up.
  float passes = sv_quality < 0.5 ? 1.0 : 2.0;
  for (float i = 1.0; i <= 2.0; i++) {
    if (i > passes) break;
    uv.x += sv_distortion * center / i * sin(t + i * 0.4 * smoothstep(0.0, 1.0, uv.y)) * cos(0.2 * t + i * 2.4 * smoothstep(0.0, 1.0, uv.y));
    uv.y += sv_distortion * center / i * cos(t + i * 2.0 * smoothstep(0.0, 1.0, uv.x));
  }
  vec2 turned = rotate(uv - 0.5, -3.0 * sv_swirl * radius) + 0.5;
  vec4 colors[8] = vec4[8](sv_color1, sv_color2, sv_color3, sv_color4, sv_color5, sv_color6, sv_color7, sv_color8);
  int count = int(clamp(sv_colors, 1.0, 8.0));
  vec3 colour = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= count) break;
    float dist = pow(length(turned - getPosition(i, t)), 3.5);
    float weight = 1.0 / (dist + 1e-3);
    colour += colors[i].rgb * weight;
    total += weight;
  }
  colour /= max(1e-4, total);
  if (sv_quality > 0.5 && sv_grain > 0.0) {
    float grain = valueNoise(rotate(grainUV, 1.0) + vec2(3.0));
    grain = mix(grain, valueNoise(rotate(grainUV, 2.0) + vec2(-1.0)), 0.5);
    grain = pow(grain, 1.3) * 2.0 - 1.0;
    colour = mix(colour, vec3(step(0.0, grain)), 0.35 * pow(sv_grain * abs(grain), 0.8));
  }
  colour = svGrade(colour) * (1.0 + 0.4 * sv_pulse);
  colour *= 1.0 - shade * IMG_NORM_PIXEL(sv_words, screen).r;
  gl_FragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`;

/** Paper Shaders' neuro noise: layers of turning sine waves, like glowing nerves. */
const NEURO_NOISE = `/*{
  "DESCRIPTION": "Glowing threads weaving like nerves, from the theme's second and third colours over its first; quieter behind the words.",
  "CREDIT": "Paper Shaders (https://github.com/paper-design/shaders), Apache-2.0; ported for Oneverse",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Oneverse", "Paper"],
  "INPUTS": [
    { "NAME": "sv_brightness", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.05 },
    { "NAME": "sv_contrast", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.3 },
    { "NAME": "sv_saturation", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.5 },
    { "NAME": "sv_hue", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 },
    ${PLACE},
    { "NAME": "quiet", "LABEL": "Quieter behind the words", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.5 },
    ${SCREEN(3)}
  ]
}*/
${COMMON}
vec2 rotate(vec2 uv, float th) { return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv; }
float neuroShape(vec2 uv, float t, int layers) {
  vec2 sineAcc = vec2(0.0);
  vec2 res = vec2(0.0);
  float scale = 8.0;
  float weight = 0.0;
  for (int j = 0; j < 15; j++) {
    if (j >= layers) break;
    uv = rotate(uv, 1.0);
    sineAcc = rotate(sineAcc, 1.0);
    vec2 layer = uv * scale + float(j) + sineAcc - t;
    sineAcc += sin(layer);
    res += (0.5 + 0.5 * cos(layer)) / scale;
    weight += 1.0 / scale;
    scale *= 1.2;
  }
  // As bright with fewer layers as with all 15 (their weights add up to 0.701).
  return (res.x + res.y) * 0.701 / weight;
}
void main() {
  vec2 uv = isf_FragNormCoord;
  // As Paper draws it on a canvas 800 pixels high.
  vec2 shapeUV = svPlace(uv) * 8.0 * 0.13;
  float t = 0.5 * TIME;
  // Fewer layers on a device that can't keep up: a little less fine, as smooth.
  int layers = sv_quality < 0.5 ? 8 : sv_quality < 1.5 ? 11 : 15;
  float noise = neuroShape(shapeUV, t, layers);
  noise = (1.0 + sv_brightness) * noise * noise;
  noise = pow(noise, 0.7 + 6.0 * sv_contrast);
  noise = min(1.4, noise);
  float blend = smoothstep(0.7, 1.4, noise);
  vec3 front = mix(sv_color3.rgb, sv_color2.rgb, blend);
  float glow = max(noise, 0.0) * (1.0 + 0.5 * sv_pulse);
  float opacity = clamp(glow, 0.0, 1.0);
  vec3 colour = front * glow + sv_color1.rgb * (1.0 - opacity);
  colour = svHueShift(colour, sv_hue * 6.28318);
  float l = dot(colour, vec3(0.2126, 0.7152, 0.0722));
  colour = mix(vec3(l), colour, sv_saturation * 2.0);
  colour = mix(colour, sv_color1.rgb, quiet * IMG_NORM_PIXEL(sv_words, uv).r);
  colour += 1.0 / 256.0 * (fract(sin(dot(0.014 * gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123) - 0.5);
  gl_FragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`;

/** The built-in shaders, by id. */
export const SCREEN_SHADERS: { id: string; source: string }[] = [
  { id: "mesh-gradient", source: MESH_GRADIENT },
  { id: "paper-mesh", source: PAPER_MESH },
  { id: "neuro-noise", source: NEURO_NOISE },
  { id: "glow-lines", source: GLOW_LINES },
  { id: "embers", source: EMBERS },
];

export function screenShader(id: string | null | undefined): string | undefined {
  return SCREEN_SHADERS.find((one) => one.id === id)?.source;
}
