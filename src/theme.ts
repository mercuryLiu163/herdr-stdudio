/** Day/night theme handling (F1). Theme is written to <html data-theme> and
 *  persisted in localStorage; all colors come from CSS variable tokens. */

export type Theme = "dark" | "light";

const KEY = "herdr-studio-theme";

export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable — theme still applies for this session */
  }
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

/** Apply as early as possible (before first paint) so reloads never flash. */
export function initTheme(): void {
  applyTheme(readStoredTheme());
}
