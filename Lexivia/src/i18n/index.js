import { useSyncExternalStore } from 'react';
import { catalogs, messages, normalizeMessage } from './messages.js';

export const LANGUAGE_KEY = 'lexivia-language';
export const languages = [{ code: 'en', name: 'English', dir: 'ltr' }, { code: 'fr', name: 'Français', dir: 'ltr' }, { code: 'ar', name: 'العربية', dir: 'rtl' }];
const valid = code => languages.some(language => language.code === code);
const listeners = new Set();
let locale = 'en';
try { const saved = localStorage.getItem(LANGUAGE_KEY); if (valid(saved)) locale = saved; } catch { /* Use English when storage is unavailable. */ }
function applyLanguage() {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
}
export function setLanguage(code) {
  if (!valid(code)) return;
  locale = code;
  try { localStorage.setItem(LANGUAGE_KEY, code); } catch { /* The current session still works. */ }
  applyLanguage();
  listeners.forEach(listener => listener());
}
window.addEventListener('storage', event => {
  if (event.key !== LANGUAGE_KEY && event.key !== null) return;
  locale = valid(event.newValue) ? event.newValue : 'en';
  applyLanguage();
  listeners.forEach(listener => listener());
});
applyLanguage();
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export function useLanguage() { return [useSyncExternalStore(subscribe, () => locale), setLanguage]; }
export function getLanguage() { return locale; }
// Match application messages assembled before rendering (validation and API errors).
const patterns = messages.filter(([source])=>/\{\w+\}/.test(source)).map(([source])=>{
  const names=[];
  const escaped=source.split(/(\{\w+\})/g).map(part=>{
    if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1,-1)); return '(.+?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');
  }).join('');
  return {source,names,regex:new RegExp(`^${escaped}$`,'i'),specificity:source.replace(/\{\w+\}/g,'').length};
}).filter(pattern=>pattern.specificity>5).sort((a,b)=>b.specificity-a.specificity);
export function translate(text, language = locale, values = {}) {
  if (typeof text !== 'string') return text;
  let translated = catalogs[language]?.[normalizeMessage(text)];
  if (!translated && /^[a-z]+(?:_[a-z]+)+$/i.test(text)) translated=catalogs[language]?.[normalizeMessage(text.replaceAll('_',' '))];
  if (!translated && language !== 'en') {
    for (const pattern of patterns) {
      const match=pattern.regex.exec(text.trim());
      if (!match) continue;
      translated=catalogs[language]?.[normalizeMessage(pattern.source)];
      values={...Object.fromEntries(pattern.names.map((name,index)=>[name,match[index+1]])),...values};
      break;
    }
  }
  translated ||= text;
  return translated.replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
}
export function t(text, values = {}) { return translate(text, locale, values); }
