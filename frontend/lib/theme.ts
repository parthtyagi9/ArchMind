"use client";
import { useEffect, useState } from "react";
// Light/dark theme. Dark is the default; the choice is remembered per browser.
export type Theme = "dark" | "light";
const KEY = "archmind-theme";

export function currentTheme(): Theme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* storage blocked: the choice lasts for this page only */ }
}

/** Runs before first paint (inlined in <head>) so a light-mode user never sees a dark flash. */
export const THEME_BOOT = `try{document.documentElement.dataset.theme=localStorage.getItem("${KEY}")==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;

/** Re-renders when the theme changes (the toggle sets data-theme on <html>). */
export function useTheme(): Theme {
  const [t, setT] = useState<Theme>("dark");
  useEffect(() => {
    setT(currentTheme());
    const obs = new MutationObserver(() => setT(currentTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return t;
}
