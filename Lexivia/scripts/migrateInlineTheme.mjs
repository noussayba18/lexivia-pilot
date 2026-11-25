// One-time migration of inline presentation colors. Uses AST locations so text,
// request payloads, SVG artwork, and non-color properties are left intact.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';
import { themeValue } from './themeColors.js';

async function migrate(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { await migrate(file); continue; }
    if (!file.endsWith('.jsx') || entry.name === 'BrandLogo.jsx') continue;
    const source = await fs.readFile(file, 'utf8');
    const tree = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const edits = [];
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'ObjectProperty' && !node.computed && node.value.type === 'StringLiteral') {
        const prop = node.key.name || node.key.value;
        const role = ['background', 'backgroundColor', 'bg'].includes(prop) ? 'surface'
          : ['border', 'borderColor', 'borderBottom', 'borderTop', 'borderLeft', 'borderRight', 'outlineColor'].includes(prop) ? 'border'
          : prop === 'color' ? 'text' : null;
        if (role && !node.value.value.includes('--lx-')) {
          const next = themeValue(node.value.value, role);
          if (next !== node.value.value) edits.push({ start: node.value.start, end: node.value.end, next: JSON.stringify(next) });
        }
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') walk(value);
      }
    }
    walk(tree);
    if (!edits.length) continue;
    let output = source;
    for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.next + output.slice(edit.end);
    await fs.writeFile(file, output);
    console.log(`${path.relative(process.cwd(), file)}: ${edits.length} colors`);
  }
}
await migrate(path.resolve('src'));
