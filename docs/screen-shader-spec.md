# Screen shader spec

A background shader (issue #297) is an [ISF](https://github.com/mrRay/ISF_Spec) fragment shader: GLSL
with a JSON header declaring its inputs. Since issue #324 every shader names what can be controlled the
same way, so that:

- the editor shows the same control under the same label whatever the shader;
- a preset or a reaction can turn "the rotation" or lift "the brightness" without knowing which shader
  draws;
- an uploaded shader that follows it behaves like a built-in one.

A shader declares only the names it has. Its own other controls stay allowed, shown after the standard
ones. The code is `packages/core/src/screens/shader-spec.ts`; `readIsf` marks each input `standard`
(a control below) or `songverse` (filled by the screen).

## Drawing

- **WebGL 2.** A shader is compiled as GLSL ES 3.00 (`packages/screen/src/lib/shader-program.ts`). One
  written for WebGL 1 still runs: `gl_FragColor`, `texture2D` and `varying` are made 3.00's. A screen
  without WebGL 2, or whose shader doesn't compile, shows the theme's colours as a slowly drifting
  gradient.
- **One pass**, over the whole screen. `isf_FragNormCoord` is the point, 0 to 1.
- **ISF's built-ins:** `TIME`, `TIMEDELTA`, `RENDERSIZE`, `FRAMEINDEX`, `DATE`, `IMG_NORM_PIXEL` and the
  others.

## Time

`TIME` is the shader's clock, in seconds, added up frame by frame (`advanceShaderClock`): it runs at the
background's `motion` (0.5 is the shader's own pace, 0 still) times `1 + 4 × movement`, the level a
movement reaction has set off. A change of pace never makes the picture jump, so a shader must use
`TIME` as it is: never multiply it by a level that changes. `sv_speed` is the pace it ran at over the
last frame, for a shader that wants it (a motion blur).

## Controls

Set by the theme (`background.shader.values`), shown in the editor, pushed by the reaction named: the
value drawn is the theme's plus the level times the share of the range given, kept in range
(`shaderControlValue`). A header's `MIN`, `MAX` and `DEFAULT` win over the ranges here, which are what a
shader gets without them.

| Name | Type | Range, default | Pushed by |
| --- | --- | --- | --- |
| `sv_brightness` | float | 0-1, 0.5 | brightness, half its range |
| `sv_contrast` | float | 0-1, 0.5 | |
| `sv_saturation` | float | 0-1, 0.5 (0 grey) | |
| `sv_hue` | float | 0-1 (a turn of the colour wheel), 0 | hue, a third of a turn |
| `sv_grain` | float | 0-1, 0 | |
| `sv_distortion` | float | 0-1, 0.3 | |
| `sv_swirl` | float | 0-1, 0 | |
| `sv_softness` | float | 0-1, 0.5 | |
| `sv_density` | float | 0-1, 0.5 | elements, 0.4 |
| `sv_size` | float | 0-1, 0.5 | elements, 0.4 |
| `sv_scale` | float | 0.25-4, 1 (more is closer) | scale, 0.07 |
| `sv_rotation` | float | -180-180 degrees, 0 | rotation (see below) |
| `sv_offset` | point2D | -1-1 screen heights from the middle, [0, 0] | |

**Placing the pattern.** Every shader gets `vec2 svPlace(vec2 uv)`: the point from the middle of the
screen in screen heights, moved by `sv_offset`, turned by `sv_rotation` and scaled by `sv_scale` (each
only if the shader declares it). The turn also adds the screen's own: the background's `spin` (degrees a
second, -30 to 30) and 90 degrees a second times a rotation reaction's level, added up like `TIME`. A
shader that draws its pattern at `svPlace(isf_FragNormCoord)` turns, scales and moves with the rest.

## Filled by the screen

Never shown as controls.

| Name | Type | What |
| --- | --- | --- |
| `sv_color1` … `sv_color8` | color | The background's colours; past the last, the last again |
| `sv_colors` | float | How many colours the background has, 1-8 |
| `sv_pulse` | float | A pulse of light, 0-1, from effects |
| `sv_movement`, `sv_elements` | float | Effects' levels, 0-1, from before the spec: use `TIME` and `sv_density`/`sv_size` instead |
| `sv_speed` | float | The clock's pace (above) |
| `sv_quality` | float | 0, 1 or 2 (below) |
| `sv_words` | image | White where the words are, blurred; keep the picture quieter there |
| `sv_image` | image | The picture a filter changes (Slideverse, later); empty for a background |

`sv_speed` and `sv_quality` can be used without declaring them.

## Quality

A screen that can't keep up (under 45 frames a second) draws less first, then smaller; once it keeps up
again (over 57), it draws at its full size first, then more (`adaptShaderDrawing`). Each shader reads
`sv_quality` and draws less at 1 and 0 - fewer layers of noise, no grain, fewer particles - so a TV
stick keeps moving smoothly. A device with two cores or two gigabytes or fewer starts at 1. A screen's
report says the quality it draws at.

## Credits

The built-in "Paper" shaders are ported from [Paper Shaders](https://github.com/paper-design/shaders)
(Apache-2.0, "Powered by Paper Shaders"), and say so in their header's `CREDIT`.
