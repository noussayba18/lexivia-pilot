// One-time source migration for catalogued UI literals. Never modifies API values,
// identifiers, event handlers, user content, or strings absent from the catalog.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';
import { catalogs, normalizeMessage } from '../src/i18n/messages.js';
const attributes = new Set(['placeholder', 'title', 'aria-label', 'alt', 'subtitle', 'label', 'description', 'sub', 'hint', 'message', 'emptyText']);
const known = value => typeof value === 'string' && Object.hasOwn(catalogs.fr, normalizeMessage(value));
async function migrate(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { await migrate(file); continue; }
    if (!file.endsWith('.jsx') || entry.name === 'BrandLogo.jsx') continue;
    const source = await fs.readFile(file, 'utf8');
    if (source.includes("from '../i18n/index.js'") && !source.includes('useInterfaceLanguage')) continue;
    const tree = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const edits = [], components = new Set();
    function componentBody(parents) {
      for (let i = parents.length - 1; i >= 0; i--) {
        const node = parents[i], parent = parents[i - 1];
        const name = node.type === 'FunctionDeclaration' ? node.id?.name
          : ['ArrowFunctionExpression','FunctionExpression'].includes(node.type) && parent?.type === 'VariableDeclarator' ? parent.id?.name : null;
        if (name && /^[A-Z]/.test(name) && node.body.type === 'BlockStatement') return node.body;
      }
      return null;
    }
    function walk(node, parents = []) {
      if (!node || typeof node !== 'object') return;
      const parent = parents.at(-1);
      let next;
      if (node.type === 'TemplateLiteral' && !parents.some(p=>p.type==='CallExpression' && p.callee?.name==='__msg')) {
        const attr = parents.findLast(p=>p.type==='JSXAttribute');
        const display = ['JSXExpressionContainer','ConditionalExpression','LogicalExpression'].includes(parent?.type) && parents.some(p=>p.type==='JSXExpressionContainer') && (!attr || attributes.has(attr.name.name));
        const key = node.quasis.map((part,index)=>part.value.cooked+(index<node.expressions.length?`{value${index}}`:'' )).join('');
        if (display && known(key)) next = `__msg(${JSON.stringify(key)}, {${node.expressions.map((expr,index)=>`value${index}: ${source.slice(expr.start,expr.end)}`).join(', ')}})`;
      }
      if (node.type === 'JSXText' && known(node.value)) {
        const text = node.value.replace(/\s+/g,' ').trim();
        next = `{__msg(${JSON.stringify(text)})}`;
        if (/^\s/.test(node.value)) next = '{" "}' + next;
        if (/\s$/.test(node.value)) next += '{" "}';
      } else if (node.type === 'StringLiteral' && known(node.value)) {
        if (parents.some(p => p.type === 'CallExpression' && p.callee?.name === '__msg')) return;
        if (parent?.type === 'JSXAttribute' && attributes.has(parent.name.name)) next = `{__msg(${JSON.stringify(node.value)})}`;
        else if (parent?.type === 'JSXExpressionContainer'
          || ['ConditionalExpression','LogicalExpression'].includes(parent?.type) && parent.test !== node && parents.some(p => p.type === 'JSXExpressionContainer') && !parents.some(p => p.type === 'JSXAttribute' && !attributes.has(p.name.name))) {
          next = `__msg(${JSON.stringify(node.value)})`;
        }
      }
      if (node.type === 'JSXExpressionContainer' && !parents.some(p=>p.type === 'JSXAttribute') && !parents.some(p=>p.type==='JSXElement' && ['style','script','code','pre'].includes(p.openingElement.name?.name))) {
        const expr = node.expression;
        const simple = expr.type === 'Identifier' && /^(?:heading|label|title|text|description|note|hint|detail|caption|step|tab|status|role|message|statusLabel|actionLabel|emptyText|error|errorMsg|errMsg|emailErrorMsg|pwErrorMsg|submitError|successMsg|healthError|versionsError)$/.test(expr.name);
        const field = expr.type === 'MemberExpression' && !expr.computed ? expr.property.name : null;
        const member = field && (/^(?:label|status|state|role|message|error|hint|placeholder|tooltip)$/.test(field)
          || /^(?:title|text|description|body|copy|note|detail|short|desc)$/.test(field) && expr.object.type==='Identifier' && /^(?:stage|step|guide|option|opt|card|point|stat|metric|tab|config|def|level|complexity)$/.test(expr.object.name));
        const displayCall = expr.type==='CallExpression' && expr.callee.type==='Identifier' && /^(?:pretty|prettyTaskType|taskLabel|sourceLabel|statusLabel|humanize|labelOfTaskType)$/.test(expr.callee.name);
        if (simple || member || displayCall) next = `{__msg(${source.slice(expr.start,expr.end)})}`;
      }
      const body = next && componentBody(parents);
      if (body) { edits.push({ start: node.start, end: node.end, next }); components.add(body); return; }
      for (const child of Object.values(node)) {
        if (Array.isArray(child)) child.forEach(n => walk(n, [...parents, node]));
        else if (child && typeof child === 'object') walk(child, [...parents, node]);
      }
    }
    walk(tree);
    if (!edits.length) continue;
    for (const body of components) if (!source.slice(body.start, body.start + 90).includes('useInterfaceLanguage();')) edits.push({ start: body.start + 1, end: body.start + 1, next: '\n  useInterfaceLanguage();' });
    let next = source;
    for (const edit of edits.sort((a,b) => b.start - a.start)) next = next.slice(0, edit.start) + edit.next + next.slice(edit.end);
    let relative = path.relative(path.dirname(file), path.resolve('src/i18n/index.js')).replaceAll('\\','/');
    if (!relative.startsWith('.')) relative = './' + relative;
    if (!source.includes('useLanguage as useInterfaceLanguage')) next = `import { t as __msg, useLanguage as useInterfaceLanguage } from '${relative}';\n` + next;
    await fs.writeFile(file, next);
    console.log(`${file}: ${edits.length - components.size} UI literals`);
  }
}
await migrate(path.resolve('src'));
