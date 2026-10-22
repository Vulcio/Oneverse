import "../styles/app.css";
import type { SetlistOfflineCopy } from "@oneverse/core";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider, useTranslation } from "react-i18next";
import { createI18n, loadLocale, supportedLocale } from "@oneverse/app/i18n";
import { OperatorConsole } from "@oneverse/operator/components/operator-console";
import { OperatorProvider } from "@oneverse/operator/host";
import { createLiveClient } from "@oneverse/operator/lib/live-client";
import { setlistTitle } from "@oneverse/screen/lib/set-items";

/**
 * The console on Oneverse Pulse's own page (issue #247, docs/live-session.md,
 * "How the room's devices reach Pulse"): opened from Live's "Continue on
 * Pulse" link while the cloud's gone, on the venue's network. The link
 * carries the pass the cloud signed (`#pass=`), kept for the tab so a reload
 * still works; the set comes from Pulse's copy (GET /set), and the console
 * talks to Pulse's /sync, entering with the pass.
 */

const PASS_KEY = "oneverse-pulse-pass";

function takePass(): string | null {
  const fromLink = new URLSearchParams(location.hash.slice(1)).get("pass");
  if (fromLink) {
    try {
      sessionStorage.setItem(PASS_KEY, fromLink);
    } catch {
      // Kept for this load only.
    }
    // Not left in the address bar, nor in the history.
    history.replaceState(null, "", location.pathname + location.search);
    return fromLink;
  }
  try {
    return sessionStorage.getItem(PASS_KEY);
  } catch {
    return null;
  }
}

type Loaded = { copy: SetlistOfflineCopy } | { problem: "noPass" | "noCopy" | "unreachable" };

async function loadSet(pass: string | null): Promise<Loaded> {
  if (!pass) return { problem: "noPass" };
  try {
    const response = await fetch("/set", { headers: { authorization: `Pass ${pass}` }, cache: "no-store" });
    if (response.status === 401) return { problem: "noPass" };
    if (response.status === 404) return { problem: "noCopy" };
    if (!response.ok) return { problem: "unreachable" };
    return { copy: (await response.json()) as SetlistOfflineCopy };
  } catch {
    return { problem: "unreachable" };
  }
}

function PulsePage({ pass }: { pass: string | null }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    void loadSet(pass).then(setLoaded);
  }, [pass]);
  // As the screen app's /operate.
  return (
    <div className="min-h-screen bg-background text-foreground">
      {!loaded ? (
        <p className="p-6 text-sm text-muted-foreground">{t("screens.operator.connecting")}</p>
      ) : "problem" in loaded ? (
        <p className="p-6 text-sm text-muted-foreground" data-testid="pulse-problem">
          {t(`screens.operator.pulse.${loaded.problem}`)}
        </p>
      ) : (
        <PulseConsole copy={loaded.copy} pass={pass!} />
      )}
    </div>
  );
}

function PulseConsole({ copy, pass }: { copy: SetlistOfflineCopy; pass: string }) {
  const { t, i18n } = useTranslation();
  const live = useMemo(() => createLiveClient({ apiUrl: location.origin, token: async () => null, pass: () => pass }), [pass]);
  useEffect(() => {
    live.open(copy.set.id);
    return () => live.close();
  }, [live, copy.set.id]);
  const { session } = live.host.useLive();
  const [picked, setPicked] = useState<string | null>(null);
  // The item looked at: the one picked, else the one on the screens.
  const itemId = (picked && copy.songs.some((one) => one.item.id === picked) ? picked : null) ?? session?.presenting?.itemId ?? session?.itemId ?? copy.songs[0]?.item.id ?? null;
  return (
    <OperatorProvider host={live.host}>
      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm" data-testid="pulse-banner">
          {t("screens.operator.pulse.onPulse")}
        </p>
        <OperatorConsole copy={copy} members={[]} positions={[]} itemId={itemId} onLook={setPicked} title={setlistTitle(copy.set, t, i18n.language)} />
      </main>
    </OperatorProvider>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing Pulse page root");
const pass = takePass();
// Opened again with another pass while already open (only the address's # changes): taken as a fresh start.
window.addEventListener("hashchange", () => {
  if (new URLSearchParams(location.hash.slice(1)).has("pass")) location.reload();
});
// The device's language (?lang= overrides it), as the player's screen does.
const locale = await loadLocale(supportedLocale(new URLSearchParams(location.search).get("lang") ?? navigator.language.slice(0, 2)));
document.documentElement.lang = locale;
createRoot(root).render(
  <StrictMode>
    <I18nextProvider i18n={createI18n(locale)}>
      <PulsePage pass={pass} />
    </I18nextProvider>
  </StrictMode>,
);
