import { useSyncExternalStore } from 'react';

export const THEME_KEY = 'lexivia-theme';
const choices = ['light', 'dark', 'system'];
const listeners = new Set();
const media = window.matchMedia('(prefers-color-scheme: dark)');
let preference = 'light';
try { preference = localStorage.getItem(THEME_KEY) || 'light'; } catch { /* Storage can be unavailable. */ }
if (!choices.includes(preference)) preference = 'light';

function applyTheme() {
  document.documentElement.dataset.theme = preference === 'system'
    ? (media.matches ? 'dark' : 'light') : preference;
}

export function setTheme(value) {
  if (!choices.includes(value)) return;
  preference = value;
  try { localStorage.setItem(THEME_KEY, value); } catch { /* Still apply for this session. */ }
  applyTheme();
  listeners.forEach(listener => listener());
}

media.addEventListener('change', applyTheme);
window.addEventListener('storage', event => {
  if (event.key !== THEME_KEY && event.key !== null) return;
  preference = choices.includes(event.newValue) ? event.newValue : 'light';
  applyTheme();
  listeners.forEach(listener => listener());
});
applyTheme();

const subscribe = listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export function useTheme() {
  return [useSyncExternalStore(subscribe, () => preference), setTheme];
}
