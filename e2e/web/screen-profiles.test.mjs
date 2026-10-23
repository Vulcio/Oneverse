// Screen profiles and temporary pairing (issue #284), in two browsers: a TV
// paired from Screens for 12 hours says when it ends, and is extended; asked
// from its settings, it shows a code again, its own profile kept (Back returns
// to it); someone else pairs it, and its menu's Profiles switches between the
// two. A profile disconnected leaves the other one showing.
import { chromium } from "playwright";
import { SCREEN, WEB, api, call, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const owner = await user("Profiles web owner");
const guest = await user("Profiles web guest");
const ownerSet = await api(owner, "POST", "/setlists", { name: `Owner's set ${stamp}` });
const guestSet = await api(guest, "POST", "/setlists", { name: `Guest's set ${stamp}` });

const browser = await chromium.launch();
try {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const phone = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const code = async () => (await tv.getByTestId("screen-code").innerText()).replace("-", "");
  const idle = (name) => tv.getByTestId("screen-idle").getByText(name).waitFor({ timeout: 15000 });
  const openMenu = async () => {
    await tv.getByTestId("screen-display").dblclick({ position: { x: 300, y: 300 } });
    await tv.getByTestId("screen-menu").waitFor();
  };
  const tile = () => phone.getByTestId("screens-list").getByTestId(`screen-Lobby ${stamp}`);

  await step("paired from Screens for 12 hours: its tile says when it ends", async () => {
    page = phone;
    await tv.goto(`${SCREEN}/`);
    const shown = await code();
    await signIn(phone, owner);
    await phone.goto(`${WEB}/screens?code=${shown}`);
    await phone.locator("#screen-name").fill(`Lobby ${stamp}`);
    await phone.locator("#screen-set").selectOption(ownerSet.id);
    await phone.getByTestId("screen-lasts").selectOption("12h");
    await phone.getByTestId("screen-pair-form").getByRole("button", { name: "Pair screen" }).click();
    await tile().getByTestId("screen-ends").getByText(/^ · Until /).waitFor();
    page = tv;
    await idle(`Owner's set ${stamp}`);
  });

  await step("Extend: unlimited, and the end is gone", async () => {
    page = phone;
    await tile().getByTestId("screen-extend").selectOption("unlimited");
    await tile().getByTestId("screen-ends").waitFor({ state: "detached" });
    const [screen] = (await call(owner, "GET", "/screens")).body.filter((one) => one.name === `Lobby ${stamp}`);
    if (screen?.expiresAt !== null) throw new Error(JSON.stringify(screen?.expiresAt));
  });

  await step("Show a code again: the screen shows one, Back returns to its set", async () => {
    await tile().getByTestId("screen-settings").click();
    await phone.getByTestId("screen-pair-again").click();
    await phone.getByTestId("screen-pair-again-hint").getByText("The screen shows a code.").waitFor();
    await phone.getByTestId("screen-dialog-done").click();
    page = tv;
    await tv.getByText("To add a profile to this screen, pair it again:").waitFor({ timeout: 10000 });
    await tv.getByTestId("screen-pairing-back").click();
    await idle(`Owner's set ${stamp}`);
  });

  await step("paired again from its own menu, by someone else: their set shows", async () => {
    await openMenu();
    await tv.getByTestId("screen-menu-profiles").click();
    await tv.getByTestId("screen-menu-pair-again").click();
    const shown = await code();
    await call(guest, "POST", `/screens/pairings/${shown}/confirm`, { name: `Guest TV ${stamp}`, setlistId: guestSet.id, lasts: "1d" });
    await idle(`Guest's set ${stamp}`);
  });

  await step("Profiles lists both, and switches back to the first", async () => {
    await openMenu();
    await tv.getByTestId("screen-menu-profiles").click();
    const profiles = tv.getByTestId("screen-menu-profile");
    await profiles.nth(1).waitFor();
    const names = await profiles.allInnerTexts();
    if (!names[0].includes(`Lobby ${stamp}`) || !names[1].includes(`Guest TV ${stamp}`)) throw new Error(JSON.stringify(names));
    await profiles.nth(0).click();
    await idle(`Owner's set ${stamp}`);
  });

  await step("the first profile disconnected: the screen shows the other", async () => {
    const [screen] = (await call(owner, "GET", "/screens")).body.filter((one) => one.name === `Lobby ${stamp}`);
    await call(owner, "DELETE", `/screens/${screen.id}`);
    await idle(`Guest's set ${stamp}`);
    await openMenu();
    await tv.getByTestId("screen-menu-profiles").click();
    if ((await tv.getByTestId("screen-menu-profile").count()) !== 1) throw new Error("the disconnected profile is still listed");
  });
} finally {
  await browser.close();
}
finish();
