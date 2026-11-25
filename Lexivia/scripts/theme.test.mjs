import test from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import themeColors, { themeValue } from './themeColors.js';
import fs from 'node:fs/promises';

test('CSS migration covers surfaces, text, variables and transparent borders', async () => {
  const { css } = await postcss([themeColors()]).process('.card{background:#fff;color:#211f54;border:1px solid #e3eaee;--text-muted:#71849a}.pill{background:var(--navy);color:white}.glass{background:rgba(255,255,255,.8)}', { from: undefined });
  assert.match(css, /background:var\(--lx-surface, #fff\)/);
  assert.match(css, /color:var\(--lx-ink, #211f54\)/);
  assert.match(css, /border:1px solid var\(--lx-line/);
  assert.match(css, /--text-muted:var\(--lx-muted/);
  assert.match(css, /background:var\(--navy\);color:white/);
  assert.match(css, /color-mix\(in srgb, var\(--lx-surface/);
  assert.match(css, /#ffffff\) 80%, transparent/); // Alpha is applied once in light mode.
});

test('brand buttons, artwork, shadows and theme preview illustrations keep their colors', async () => {
  assert.equal(themeValue('#211f54', 'surface'), '#211f54');
  const source = '.art{fill:#211f54;box-shadow:0 1px #fff}.theme-swatch{background:#fff}';
  const { css } = await postcss([themeColors()]).process(source, { from: undefined });
  assert.equal(css, source);
});

test('legacy background variables and pale CSS gradients follow the selected theme',async()=>{
 const source='.page{--color-background-primary:#fff;--indigo-light:#eef2ff;background-image:linear-gradient(#fff,#f8fafc)}.photo{background-image:url("/white.png")}';
 const {css}=await postcss([themeColors()]).process(source,{from:undefined});
 assert.match(css,/--color-background-primary:var\(--lx-surface/);
 assert.match(css,/--indigo-light:var\(--lx-navy-soft/);
 assert.match(css,/linear-gradient\(var\(--lx-surface/);
 assert.match(css,/background-image:url\("\/white.png"\)/);
});

test('dataset cards and headings are compiled through the shared theme pipeline',async()=>{
 const source=await fs.readFile(new URL('../src/styles/DatasetDetails.theme.css',import.meta.url),'utf8');
 const {root}=await postcss([themeColors()]).process(source,{from:undefined});
 for(const selector of ['.dsd-head','.dsd-stat','.dsd-card','.dsd-select']) {
  const rule=root.nodes.find(node=>node.selector===selector);
  assert.ok(rule,'Missing dataset style '+selector);
  const background=rule.nodes.find(decl=>/^background/.test(decl.prop));
  assert.match(background.value,/--lx-surface/);
 }
 const heading=root.nodes.find(node=>node.selector==='.dsd-title');
 assert.match(heading.nodes.find(decl=>decl.prop==='color').value,/--lx-ink/);
});

test('theme persistence, system changes, cross-tab sync and unavailable storage', async () => {
  const events = {}, mediaEvents = {};
  const media = { matches: false, addEventListener: (name, callback) => mediaEvents[name] = callback };
  const stored = new Map([['lexivia-theme', 'dark']]);
  globalThis.window = { matchMedia: () => media, addEventListener: (name, callback) => events[name] = callback };
  globalThis.document = { documentElement: { dataset: {} } };
  globalThis.localStorage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  const { setTheme } = await import('../src/theme.js');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  setTheme('light');
  assert.equal(stored.get('lexivia-theme'), 'light');
  assert.equal(document.documentElement.dataset.theme, 'light');
  setTheme('system');
  assert.equal(document.documentElement.dataset.theme, 'light');
  media.matches = true;
  mediaEvents.change();
  assert.equal(document.documentElement.dataset.theme, 'dark');
  setTheme('light');
  mediaEvents.change();
  assert.equal(document.documentElement.dataset.theme, 'light');
  events.storage({ key: 'lexivia-theme', newValue: 'dark' });
  assert.equal(document.documentElement.dataset.theme, 'dark');
  setTheme('invalid');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  events.storage({ key: null, newValue: null });
  assert.equal(document.documentElement.dataset.theme, 'light');
  globalThis.localStorage = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } };
  const restricted = await import('../src/theme.js?storage-blocked');
  assert.equal(document.documentElement.dataset.theme, 'light');
  restricted.setTheme('dark');
  assert.equal(document.documentElement.dataset.theme, 'dark');
});
