"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

export const THEME_KEY = "promise-ledger:theme";
type Theme = "light" | "dark";

/** Runs before first paint (inlined in the root layout) so a saved or OS dark preference never flashes light. */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}})()`;

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

const readTheme = (): Theme => document.documentElement.dataset.theme === "dark" ? "dark" : "light";

export function ThemeToggle({ className = "theme-toggle" }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => null);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage unavailable */ }
  }

  const dark = theme === "dark";
  return (
    <button type="button" className={className} onClick={toggle} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title={dark ? "Light theme" : "Dark theme"}>
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
