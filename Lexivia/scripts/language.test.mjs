import test from 'node:test';
import assert from 'node:assert/strict';
import { messages, catalogs, normalizeMessage } from '../src/i18n/messages.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';

test('French and Arabic entries are present and retain interpolation placeholders', () => {
  for (const [english, french, arabic] of messages) {
    assert.ok(french?.trim(), `Missing French: ${english}`);
    assert.ok(arabic?.trim(), `Missing Arabic: ${english}`);
    const variables = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(variables(french), variables(english), english);
    assert.deepEqual(variables(arabic), variables(english), english);
  }
  assert.equal(catalogs.fr[normalizeMessage('EMAIL ADDRESS')], 'Adresse e-mail');
  assert.equal(catalogs.ar[normalizeMessage('Language')], 'اللغة');
});

test('translations never alter machine-readable JSX attributes or editable values', async () => {
  const unsafe = new Set(['value','key','type','name','mode','to','href','id','htmlFor','className','role','initialTab','aria-live','aria-current','aria-expanded','aria-selected','aria-pressed','aria-hidden','aria-modal','aria-busy']);
  function containsMessage(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.type === 'CallExpression' && node.callee?.name === '__msg') return true;
    return Object.values(node).some(value => Array.isArray(value) ? value.some(containsMessage) : containsMessage(value));
  }
  async function scan(dir) {
    for (const entry of await fs.readdir(dir,{withFileTypes:true})) {
      const file = path.join(dir,entry.name);
      if (entry.isDirectory()) { await scan(file); continue; }
      if (!file.endsWith('.jsx')) continue;
      const tree = parse(await fs.readFile(file,'utf8'),{sourceType:'module',plugins:['jsx']});
      function walk(node) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'JSXAttribute' && unsafe.has(node.name.name)) assert.ok(!containsMessage(node.value), `${file}: translated ${node.name.name}`);
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach(walk);
          else if (value && typeof value === 'object') walk(value);
        }
      }
      walk(tree);
    }
  }
  await scan(path.resolve('src'));
});

test('language choice persists, handles RTL, updates other tabs and falls back safely', async () => {
  const stored = new Map([['lexivia-language','fr']]);
  const handlers = {};
  globalThis.document = { documentElement: {} };
  globalThis.window = { addEventListener: (event, callback) => handlers[event] = callback };
  globalThis.localStorage = { getItem: key => stored.get(key), setItem: (key,value) => stored.set(key,value) };
  const {setLanguage,t,translate} = await import('../src/i18n/index.js');
  assert.equal(document.documentElement.lang, 'fr');
  assert.equal(document.documentElement.dir, 'ltr');
  assert.equal(t('Settings'), 'Paramètres');
  setLanguage('ar');
  assert.equal(document.documentElement.dir, 'rtl');
  assert.equal(stored.get('lexivia-language'), 'ar');
  assert.equal(t('Settings'), 'الإعدادات');
  setLanguage('unsupported');
  assert.equal(document.documentElement.lang, 'ar');
  handlers.storage({key:'lexivia-language',newValue:'en'});
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.documentElement.dir, 'ltr');
  assert.equal(t('Settings'), 'Settings');
  assert.equal(translate('Uncatalogued sentence', 'fr'), 'Uncatalogued sentence');
  assert.equal(translate('Continue with {provider}', 'fr', {provider:'Google'}), 'Continuer avec Google');
  assert.equal(translate('{theme} theme selected. Saved for this browser.', 'ar', {theme:'داكن'}), 'تم اختيار المظهر داكن. حُفظ الاختيار في هذا المتصفح.');
  assert.equal(translate(null, 'ar'), null);
  assert.equal(translate('Another task is already called "Darija Task".', 'fr'), 'Une autre tâche porte déjà le nom « Darija Task ».');
  assert.equal(translate('Maya requested to join "Darija Challenge".', 'ar'), 'طلب Maya الانضمام إلى «Darija Challenge».');
  assert.equal(translate('Bari Ben', 'ar'), 'Bari Ben');
  assert.equal(translate('Community sample content stays in its original language.', 'fr'), 'Community sample content stays in its original language.');
  const {relativeTime,duration}=await import('../src/i18n/format.js');
  setLanguage('fr');
  assert.match(relativeTime(new Date(Date.now()-120000).toISOString()), /minutes/);
  setLanguage('ar');
  assert.doesNotMatch(relativeTime(new Date(Date.now()-120000).toISOString()), /ago|minute/);
  assert.doesNotMatch(duration(180), /min|second/);
  assert.equal(relativeTime('invalid'), '—');
  handlers.storage({key:null,newValue:null});
  assert.equal(document.documentElement.lang, 'en');
  globalThis.localStorage = { getItem: () => {throw Error('disabled')}, setItem: () => {throw Error('disabled')} };
  const restricted = await import('../src/i18n/index.js?blocked-storage');
  assert.equal(document.documentElement.lang, 'en');
  restricted.setLanguage('ar');
  assert.equal(document.documentElement.dir, 'rtl');
});
