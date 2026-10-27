// Shader backgrounds (issue #297): ISF fragment shaders drawn with WebGL - the built-in ones, and one uploaded with a
// background theme (checked by the API: a shader without a usable ISF header is refused). On a screen each moves, its
// controls take the theme's values, its sv_ inputs the theme's colours; one that doesn't compile shows the colours
// instead. In the editor: the shader picked, its controls built from its header. Screenshots go to e2e/.artifacts.
import { chromium } from "playwright";
import { API, SCREEN, SP, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Shaders admin");
const set = await api(admin, "POST", "/setlists", { name: `Shaders ${stamp}` });
const song = await api(admin, "POST", "/song-versions", {
  title: `Shaders song ${stamp}`,
  language: "en",
  artists: ["Someone"],
  content: "{start_of_verse}\nAmazing grace how sweet the sound\nThat saved a wretch like me\nI once was lost but now am found\nWas blind but now I see\n{end_of_verse}\n",
  contentFormat: "CHORDPRO",
});
await api(admin, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
const [item] = (await api(admin, "GET", `/setlists/${set.id}`)).items;
const template = await api(admin, "POST", "/screen-themes", { name: `Shaded ${stamp}`, content: { builtIn: "concert" }, background: { builtIn: "mesh-gradient" }, effects: { builtIn: "concert" } });

/** A shader that fills the screen with one input's colour, or with the theme's first colour. */
const FLAT = `/*{
  "DESCRIPTION": "Flat", "CREDIT": "e2e",
  "INPUTS": [
    { "NAME": "tint", "LABEL": "Tint", "TYPE": "color", "DEFAULT": [0, 0, 1, 1] },
    { "NAME": "useTheme", "LABEL": "Use the theme's colour", "TYPE": "bool", "DEFAULT": false },
    { "NAME": "sv_color1", "TYPE": "color" }
  ]
}*/
void main() { gl_FragColor = vec4(useTheme ? sv_color1.rgb : tint.rgb, 1.0); }
`;

async function uploadShader(partId, name, source) {
  const form = new FormData();
  form.append("file", new Blob([source], { type: "application/octet-stream" }), name);
  const res = await fetch(`${API}/screen-parts/${partId}/assets?kind=shader`, { method: "POST", headers: { Authorization: `Bearer ${admin.bearer}` }, body: form });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const browser = await chromium.launch();
let leading;
try {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const desk = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errors = [];
  for (const one of [tv, desk]) one.on("pageerror", (error) => errors.push(error.message));
  page = tv;
  // What the screen shows, sampled from a screenshot (a WebGL canvas can't be read back once drawn): the colour in
  // the top left corner (away from the words), how much differs from it, and a fingerprint.
  const look = async () => {
    const shot = (await tv.screenshot({ type: "png" })).toString("base64");
    return tv.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const copy = document.createElement("canvas");
      copy.width = 64;
      copy.height = 36;
      const context = copy.getContext("2d");
      context.drawImage(image, 0, 0, 64, 36);
      const pixels = context.getImageData(0, 0, 64, 36).data;
      const corner = [pixels[64 * 4 * 2 + 8], pixels[64 * 4 * 2 + 9], pixels[64 * 4 * 2 + 10]];
      let lit = 0;
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (Math.abs(pixels[i] - corner[0]) + Math.abs(pixels[i + 1] - corner[1]) + Math.abs(pixels[i + 2] - corner[2]) > 30) lit++;
        sum = (sum * 31 + pixels[i] + pixels[i + 1] * 3 + pixels[i + 2] * 7) % 1000003;
      }
      return { corner, lit, sum };
    }, shot);
  };
  const drawing = () => tv.locator('[data-testid="screen-shader"][data-state="drawing"] canvas[data-ready]').waitFor({ timeout: 15000 });

  await step("a screen presenting a song over a shader", async () => {
    await tv.goto(`${SCREEN}/`);
    const code = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    await api(admin, "POST", `/screens/pairings/${code}/confirm`, { name: `Shader TV ${stamp}`, setlistId: set.id, themeId: template.id });
    leading = await syncDevice(admin);
    leading.send({ type: "join", setId: set.id });
    await leading.next((m) => m.type === "session");
    leading.send({ type: "lead" });
    await leading.next((m) => m.type === "session" && m.leading);
    leading.send({ type: "update", presenting: { itemId: item.id, slide: 0, black: false } });
    await tv.getByTestId("screen-lines").getByText("Amazing grace", { exact: false }).waitFor({ timeout: 15000 });
    await drawing();
  });

  for (const kind of ["mesh-gradient", "paper-mesh", "neuro-noise", "glow-lines", "embers"]) {
    await step(`${kind}: drawn with WebGL 2, moving`, async () => {
      await api(admin, "PATCH", `/screen-themes/${template.id}`, { background: { builtIn: kind } });
      await tv.locator(`[data-testid="screen-stage"][data-background="shader"]`).waitFor();
      await drawing();
      await tv.waitForTimeout(1200);
      const first = await look();
      await tv.screenshot({ path: `${SP}/screen-shader-${kind}.png` });
      await tv.waitForTimeout(900);
      const later = await look();
      if (first.lit < 40) throw new Error(`hardly anything drawn: ${JSON.stringify(first)}`);
      if (first.sum === later.sum) throw new Error("not moving");
    });
  }

  let part;
  let flat;
  await step("an uploaded shader: refused without an ISF header, kept with one", async () => {
    part = await api(admin, "POST", "/screen-parts", { kind: "background", name: `Flat ${stamp}`, document: { background: { kind: "shader", colors: ["#00ff00"] } } });
    const refused = await uploadShader(part.id, "plain.fs", "void main() { gl_FragColor = vec4(1.0); }");
    if (refused.status !== 400 || !String(refused.body?.message).includes("ISF header")) throw new Error(JSON.stringify(refused));
    const wrongName = await uploadShader(part.id, "flat.txt", FLAT);
    if (wrongName.status !== 400) throw new Error(JSON.stringify(wrongName));
    const kept = await uploadShader(part.id, "flat.fs", FLAT);
    if (kept.status !== 201 || kept.body.kind !== "shader") throw new Error(JSON.stringify(kept));
    flat = kept.body;
  });

  await step("on the screen: its controls take the theme's values, its sv_ inputs the theme's colours", async () => {
    await api(admin, "PATCH", `/screen-parts/${part.id}`, { document: { background: { kind: "shader", colors: ["#00ff00"], shader: { asset: flat.id, values: { tint: [1, 0, 0, 1] } } } } });
    await api(admin, "PATCH", `/screen-themes/${template.id}`, { background: { id: part.id } });
    await drawing();
    await tv.waitForTimeout(500);
    const red = await look();
    if (!(red.corner[0] > 200 && red.corner[1] < 40 && red.corner[2] < 40)) throw new Error(`not the tint: ${JSON.stringify(red.corner)}`);
    await api(admin, "PATCH", `/screen-parts/${part.id}`, { document: { background: { kind: "shader", colors: ["#00ff00"], shader: { asset: flat.id, values: { useTheme: true } } } } });
    await tv.waitForTimeout(1500);
    const green = await look();
    if (!(green.corner[1] > 200 && green.corner[0] < 40 && green.corner[2] < 40)) throw new Error(`not the theme's colour: ${JSON.stringify(green.corner)}`);
  });

  await step("a shader that doesn't compile: the colours instead, nothing broken", async () => {
    const broken = await uploadShader(part.id, "broken.fs", '/*{ "INPUTS": [] }*/\nvoid main() { gl_FragColor = nope; }\n');
    if (broken.status !== 201) throw new Error(JSON.stringify(broken));
    await api(admin, "PATCH", `/screen-parts/${part.id}`, { document: { background: { kind: "shader", colors: ["#00ff00", "#0000ff"], shader: { asset: broken.body.id } } } });
    await tv.locator('[data-testid="screen-shader"][data-state="failed"]').waitFor({ timeout: 15000 });
    await tv.getByTestId("screen-lines").getByText("Amazing grace", { exact: false }).waitFor();
  });

  await step("in the editor: a shader picked, its controls from its header, saved", async () => {
    page = desk;
    await signIn(desk, admin);
    await desk.goto(`${WEB}/screens?tab=templates`);
    await desk.getByTestId("templates-view-background").click();
    await desk.getByTestId("new-part-background").click();
    const editor = desk.getByTestId("part-editor");
    await editor.getByTestId("theme-background").locator('[data-value="shader"]').click();
    await editor.locator('[data-testid="theme-preview"] [data-testid="screen-shader"]').waitFor();
    // Mesh gradient: the spec's controls it has (issue #324) and its own shade - the inputs the screen fills aren't controls.
    await editor.locator('[data-testid="theme-shader-input"][data-name="sv_softness"]').waitFor();
    if ((await editor.getByTestId("theme-shader-input").count()) !== 11) throw new Error(`mesh gradient controls: ${await editor.getByTestId("theme-shader-input").count()}`);
    await editor.getByTestId("theme-shader").locator('[data-value="embers"]').click();
    await editor.locator('[data-testid="theme-shader-input"][data-name="falling"] input[type="checkbox"]').check();
    await desk.screenshot({ path: `${SP}/screen-shader-editor.png` });
    await editor.locator("#theme-name").fill(`Falling embers ${stamp}`);
    await editor.getByTestId("theme-save").click();
    await editor.waitFor({ state: "detached" });
    const saved = (await api(admin, "GET", "/screen-parts?kind=background")).find((one) => one.name === `Falling embers ${stamp}`);
    const shader = saved?.document.background.shader;
    if (saved?.document.background.kind !== "shader" || shader?.builtIn !== "embers" || shader.values.falling !== true) throw new Error(JSON.stringify(saved?.document.background));
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
} finally {
  leading?.close();
  await browser.close();
  for (const one of await api(admin, "GET", "/screens")) await api(admin, "DELETE", `/screens/${one.id}`);
}
finish();
