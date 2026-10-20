/**
 * Built-in ISF shaders (issue #297), written for Songverse: each draws in the
 * background theme's colours (`sv_color1` the base, the others its lights),
 * answers effects (`sv_movement`, `sv_hue`, `sv_brightness`, `sv_elements`,
 * `sv_pulse`) and keeps clear of the words (`sv_words`). Their other inputs
 * are the controls the background editor shows. GLSL ES 1.00, one pass:
 * they run on a TV's browser. Their names are in the locale files
 * (`screens.editor.shaders.<id>`).
 */

const SONGVERSE_INPUTS = `
    { "NAME": "sv_color1", "TYPE": "color", "DEFAULT": [0.02, 0.01, 0.06, 1] },
    { "NAME": "sv_color2", "TYPE": "color", "DEFAULT": [0.43, 0.16, 0.85, 1] },
    { "NAME": "sv_color3", "TYPE": "color", "DEFAULT": [0.86, 0.15, 0.47, 1] },
    { "NAME": "sv_color4", "TYPE": "color", "DEFAULT": [0.05, 0.65, 0.91, 1] },
    { "NAME": "sv_movement", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 },
    { "NAME": "sv_hue", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 },
    { "NAME": "sv_brightness", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 },
    { "NAME": "sv_elements", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 },
    { "NAME": "sv_pulse", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0 },
    { "NAME": "sv_words", "TYPE": "image" }`;

const COMMON = `
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

const MESH_GRADIENT = `/*{
  "DESCRIPTION": "Soft colours slowly morphing into one another, a little darker behind the words.",
  "CREDIT": "Songverse",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Songverse"],
  "INPUTS": [
    { "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "MIN": 0, "MAX": 2, "DEFAULT": 0.35 },
    { "NAME": "softness", "LABEL": "Softness", "TYPE": "float", "MIN": 0.15, "MAX": 1, "DEFAULT": 0.55 },
    { "NAME": "grain", "LABEL": "Grain", "TYPE": "float", "MIN": 0, "MAX": 0.15, "DEFAULT": 0.03 },
    { "NAME": "shade", "LABEL": "Shade behind the words", "TYPE": "float", "MIN": 0, "MAX": 0.8, "DEFAULT": 0.3 },${SONGVERSE_INPUTS}
  ]
}*/
${COMMON}
void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = TIME * speed * (1.0 + sv_movement * 2.0);
  vec2 a = vec2(aspect * (0.5 + 0.38 * sin(t * 0.31)), 0.5 + 0.36 * cos(t * 0.27));
  vec2 b = vec2(aspect * (0.5 + 0.40 * cos(t * 0.23 + 1.7)), 0.5 + 0.38 * sin(t * 0.37 + 0.4));
  vec2 c = vec2(aspect * (0.5 + 0.36 * sin(t * 0.19 + 3.1)), 0.5 + 0.40 * cos(t * 0.29 + 2.2));
  float s = softness * softness * (0.5 + sv_elements * 0.6);
  float wa = exp(-pow(distance(p, a), 2.0) / s);
  float wb = exp(-pow(distance(p, b), 2.0) / s);
  float wc = exp(-pow(distance(p, c), 2.0) / s);
  float total = wa + wb + wc + 0.0001;
  vec3 light = (sv_color2.rgb * wa + sv_color3.rgb * wb + sv_color4.rgb * wc) / total;
  vec3 colour = mix(sv_color1.rgb, light, clamp(total, 0.0, 1.0));
  colour = hueShift(colour, sv_hue * 2.0944);
  colour *= 1.0 + 0.5 * sv_brightness + 0.4 * sv_pulse;
  colour *= 1.0 - shade * IMG_NORM_PIXEL(sv_words, uv).r;
  colour += (hash(uv * RENDERSIZE + fract(TIME)) - 0.5) * grain;
  gl_FragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`;

const GLOW_LINES = `/*{
  "DESCRIPTION": "Glowing lines waving across the screen, their colours split at the edges, quieter behind the words.",
  "CREDIT": "Songverse",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Songverse"],
  "INPUTS": [
    { "NAME": "count", "LABEL": "Lines", "TYPE": "float", "MIN": 1, "MAX": 8, "DEFAULT": 4 },
    { "NAME": "amplitude", "LABEL": "Height", "TYPE": "float", "MIN": 0, "MAX": 0.5, "DEFAULT": 0.16 },
    { "NAME": "frequency", "LABEL": "Waves", "TYPE": "float", "MIN": 0.5, "MAX": 6, "DEFAULT": 1.6 },
    { "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "MIN": 0, "MAX": 3, "DEFAULT": 0.6 },
    { "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "MIN": 0.002, "MAX": 0.05, "DEFAULT": 0.012 },
    { "NAME": "split", "LABEL": "Colour split", "TYPE": "float", "MIN": 0, "MAX": 0.3, "DEFAULT": 0.06 },
    { "NAME": "quiet", "LABEL": "Quieter behind the words", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.75 },${SONGVERSE_INPUTS}
  ]
}*/
${COMMON}
float line(float x, float y, float t, float i, float amp) {
  float offset = (i - (count - 1.0) / 2.0) * 0.07;
  float wave = sin((x + t + i * 1.3) * frequency * 3.14159) * amp;
  return glow / abs(y - 0.5 - offset - wave);
}
void main() {
  vec2 uv = isf_FragNormCoord;
  float t = TIME * speed * (1.0 + sv_movement * 2.0);
  float amp = amplitude * (1.0 + sv_elements * 1.5 + sv_pulse);
  float d = split * (abs(uv.x - 0.5) * 2.0);
  vec3 colour = sv_color1.rgb;
  for (int n = 0; n < 8; n++) {
    float i = float(n);
    if (i >= count) break;
    vec3 tint = mod(i, 3.0) < 1.0 ? sv_color2.rgb : mod(i, 3.0) < 2.0 ? sv_color3.rgb : sv_color4.rgb;
    float r = line(uv.x * (1.0 + d), uv.y, t, i, amp);
    float g = line(uv.x, uv.y, t, i, amp);
    float b = line(uv.x * (1.0 - d), uv.y, t, i, amp);
    colour += vec3(r * tint.r, g * tint.g, b * tint.b) * (0.6 + 0.6 * sv_brightness);
  }
  colour = hueShift(colour, sv_hue * 2.0944);
  colour = mix(colour, sv_color1.rgb, quiet * IMG_NORM_PIXEL(sv_words, uv).r);
  gl_FragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`;

const EMBERS = `/*{
  "DESCRIPTION": "Soft points of light rising in depth, glimmering; they swell with the words.",
  "CREDIT": "Songverse",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Songverse"],
  "INPUTS": [
    { "NAME": "density", "LABEL": "How many", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.45 },
    { "NAME": "size", "LABEL": "Size", "TYPE": "float", "MIN": 0.2, "MAX": 2, "DEFAULT": 1 },
    { "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "MIN": 0, "MAX": 2, "DEFAULT": 0.35 },
    { "NAME": "blur", "LABEL": "Blur", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0.6 },
    { "NAME": "falling", "LABEL": "Falling", "TYPE": "bool", "DEFAULT": false },${SONGVERSE_INPUTS}
  ]
}*/
${COMMON}
void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = TIME * speed * (1.0 + sv_movement * 2.0) * (falling ? -1.0 : 1.0);
  vec3 colour = sv_color1.rgb;
  for (int n = 0; n < 4; n++) {
    float layer = float(n);
    float scale = 5.0 + layer * 3.5;
    vec2 q = p * scale - vec2(0.0, t * (1.0 + layer * 0.35));
    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5;
    float seed = hash(id + layer * 13.0);
    if (seed > density) continue;
    vec2 centre = vec2(hash(id + 1.7), hash(id + 4.1)) - 0.5;
    float r = (0.08 + 0.14 * hash(id + 3.1)) * size * (1.0 + sv_elements * 0.6);
    float dist = length(f - centre * 0.6);
    float light = 1.0 - smoothstep(r * (1.0 - blur * 0.9), r, dist);
    float twinkle = 0.6 + 0.4 * sin(TIME * 2.0 + seed * 40.0);
    vec3 tint = mix(sv_color2.rgb, mix(sv_color3.rgb, sv_color4.rgb, hash(id + 9.3)), hash(id + 7.0));
    colour += tint * light * twinkle * (1.0 / (1.0 + layer * 0.6)) * (0.7 + 0.5 * sv_brightness + 0.4 * sv_pulse);
  }
  colour = hueShift(colour, sv_hue * 2.0944);
  colour = mix(colour, sv_color1.rgb, 0.35 * IMG_NORM_PIXEL(sv_words, uv).r);
  gl_FragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`;

/** The built-in shaders, by id. */
export const SCREEN_SHADERS: { id: string; source: string }[] = [
  { id: "mesh-gradient", source: MESH_GRADIENT },
  { id: "glow-lines", source: GLOW_LINES },
  { id: "embers", source: EMBERS },
];

export function screenShader(id: string | null | undefined): string | undefined {
  return SCREEN_SHADERS.find((one) => one.id === id)?.source;
}
