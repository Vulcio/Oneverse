import type { IsfInput, IsfShader } from "@oneverse/core";

/**
 * An ISF shader made a WebGL 2 program (issues #297, #324): shared by
 * whatever draws one - a screen's background now, Slideverse's filters
 * later.
 */

export const SHADER_VERTEX = `#version 300 es
in vec2 position;
out vec2 isf_FragNormCoord;
void main() {
  isf_FragNormCoord = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const UNIFORM_TYPES: Record<IsfInput["type"], string> = {
  float: "float",
  bool: "bool",
  long: "int",
  color: "vec4",
  point2D: "vec2",
  image: "sampler2D",
  event: "bool",
  audio: "sampler2D",
  audioFFT: "sampler2D",
};

/**
 * GLSL ES 3.00: ISF's built-ins, the shader spec's (`sv_speed`, `sv_quality`
 * unless the shader declares them, and `svPlace()`), its inputs as uniforms,
 * then the shader's GLSL - written for WebGL 1 (`gl_FragColor`, `texture2D`)
 * or 2, its words made 3.00's.
 */
export function shaderFragmentSource(shader: IsfShader): string {
  const declared = new Set(shader.inputs.map((input) => input.name));
  const uniforms = shader.inputs.map((input) => `uniform ${UNIFORM_TYPES[input.type]} ${input.name};`).join("\n");
  const spec = ["sv_speed", "sv_quality"].filter((name) => !declared.has(name)).map((name) => `uniform float ${name};`).join("\n");
  const body = shader.body
    .replace(/^\s*#version.*$/m, "")
    .replace(/\bgl_FragColor\b/g, "isf_FragColor")
    .replace(/\btexture2D\b/g, "texture")
    .replace(/\bvarying\b/g, "in");
  return `#version 300 es
precision highp float;
precision highp int;
uniform float TIME;
uniform float TIMEDELTA;
uniform vec2 RENDERSIZE;
uniform int FRAMEINDEX;
uniform vec4 DATE;
uniform vec4 SV_PLACE;
uniform vec2 SV_SHIFT;
in vec2 isf_FragNormCoord;
out vec4 isf_FragColor;
#define IMG_NORM_PIXEL(image, coord) texture(image, coord)
#define IMG_THIS_NORM_PIXEL(image) texture(image, isf_FragNormCoord)
#define IMG_PIXEL(image, coord) texture(image, (coord) / RENDERSIZE)
#define IMG_THIS_PIXEL(image) texture(image, isf_FragNormCoord)
#define IMG_SIZE(image) RENDERSIZE
${uniforms}
${spec}
/* A point of the screen (0 to 1) where the pattern is: from the middle, in screen heights, moved by sv_offset, turned by sv_rotation and the screen's turn, scaled by sv_scale. */
vec2 svPlace(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(SV_PLACE.w, 1.0) - SV_SHIFT;
  return mat2(SV_PLACE.x, -SV_PLACE.y, SV_PLACE.y, SV_PLACE.x) * p * SV_PLACE.z;
}
#line 1
${body}`;
}

export interface ShaderProgram {
  program: WebGLProgram;
  inputs: IsfInput[];
  set: {
    float: (name: string, value: number) => void;
    int: (name: string, value: number) => void;
    vec2: (name: string, value: number[]) => void;
    vec4: (name: string, value: number[]) => void;
  };
}

/** The shader compiled and linked over a triangle covering the screen; why not, when it can't be. */
export function buildShaderProgram(gl: WebGL2RenderingContext, shader: IsfShader): ShaderProgram | string {
  const compile = (type: number, source: string) => {
    const one = gl.createShader(type)!;
    gl.shaderSource(one, source);
    gl.compileShader(one);
    if (!gl.getShaderParameter(one, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(one) ?? "";
      gl.deleteShader(one);
      return log.trim().split("\n")[0] || "The shader doesn't compile";
    }
    return one;
  };
  const vertex = compile(gl.VERTEX_SHADER, SHADER_VERTEX);
  if (typeof vertex === "string") return vertex;
  const fragment = compile(gl.FRAGMENT_SHADER, shaderFragmentSource(shader));
  if (typeof fragment === "string") return fragment;
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return gl.getProgramInfoLog(program)?.trim() || "The shader doesn't link";
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // One triangle past the corners: the whole screen, no seam.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const locations = new Map<string, WebGLUniformLocation | null>();
  const at = (name: string) => {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
    return locations.get(name)!;
  };
  return {
    program,
    inputs: shader.inputs,
    set: {
      float: (name, value) => gl.uniform1f(at(name), value),
      int: (name, value) => gl.uniform1i(at(name), Math.round(value)),
      vec2: (name, value) => gl.uniform2f(at(name), value[0] ?? 0, value[1] ?? 0),
      vec4: (name, value) => gl.uniform4f(at(name), value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1),
    },
  };
}
