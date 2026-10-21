import "../styles/app.css";
import { composeBuiltInTemplate, type ScreenSlide } from "@oneverse/core";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { createI18n, loadLocale, supportedLocale } from "@oneverse/app/i18n";
import { ScreenStage, type StageSong } from "../components/screen-stage";

/** Local Rust mock state; replace with a versioned local stage snapshot later. */
type Snapshot = {
  set: { title: string; slides: { title: string; lines: string[] }[] };
  index: number;
};

const builtIn = composeBuiltInTemplate("classic");
if (!builtIn) throw new Error("Built-in classic screen theme is unavailable");
const theme = builtIn;

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    async function refresh() {
      try {
        const result = await fetch("/api/state", { cache: "no-store", signal: controller.signal });
        if (!result.ok) throw new Error(`HTTP ${result.status}`);
        const value = (await result.json()) as Snapshot;
        if (!stopped) {
          setSnapshot(value);
          setError(false);
        }
      } catch {
        if (!stopped) setError(true);
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 250);
    return () => { stopped = true; controller.abort(); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      const endpoint = event.key === "ArrowRight" ? "/api/next" : event.key === "ArrowLeft" ? "/api/previous" : null;
      if (endpoint) {
        event.preventDefault();
        void fetch(endpoint, { method: "POST" });
      }
    };
    window.addEventListener("keydown", press);
    return () => window.removeEventListener("keydown", press);
  }, []);

  const slides: ScreenSlide[] = (snapshot?.set.slides ?? []).map((slide, index) => ({
    passIndex: index,
    passId: `demo-${index}`,
    label: slide.title,
    lines: slide.lines,
    part: 0,
  }));
  const song: StageSong | null = snapshot
    ? { key: "local-demo", title: snapshot.set.title, slides }
    : null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "black", color: "white" }}>
      <ScreenStage theme={theme} song={song} slide={snapshot?.index ?? 0} black={false} className="size-full" />
      {error && <div role="status" style={{ position: "fixed", bottom: 12, right: 12, color: "#aaa", fontSize: 14 }}>Local player disconnected</div>}
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing player screen root");
// The app's own messages, in the device's language (?lang= overrides it): the stage's words are translated as on /screen.
const locale = await loadLocale(supportedLocale(new URLSearchParams(location.search).get("lang") ?? navigator.language.slice(0, 2)));
createRoot(root).render(<StrictMode><I18nextProvider i18n={createI18n(locale)}><App /></I18nextProvider></StrictMode>);
