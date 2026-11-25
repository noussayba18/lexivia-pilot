import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';
import { catalogs, normalizeMessage } from '../src/i18n/messages.js';

const displayAttributes = new Set(['placeholder','title','aria-label','alt','subtitle','label','description','hint','message','emptyText','sub']);
const displayFields = new Set(['label','title','description','copy','hint','placeholder','body','q','a','audience','note','message','short','text','action','empty','heading','help','caption','tooltip']);
// Machine identifiers, library names and example proper names are intentionally invariant.
const technical = /^(?:Lexivia|Google|GitHub|LinkedIn|Python|PyTorch|TensorFlow|NumPy|Pandas|torch|transformers|scikit-learn|Jupyter|JSON|JSONL|CSV|TSV|CoNLL|UTF-8|CPU|GPU|RAM|CUDA|NLP|Macro F1|Micro F1|F1|WER|CER|RMSE|MAE|Precision|Recall|BLEU|ROUGE|AUROC|AUC|F1-score|Macro F1-score|API|ID|ID-|URL|HTTP|HTTPS|HTML|SQL|STDIN|STDOUT|STDERR|Ctrl|Enter|Escape|Tab|Backspace|Delete|Shift|Alt|None|True|False|NaN|Infinity|AM|PM|NL|SK|YL|AT|SY|VM|DEMO|English|Français|العربية|user_name|metric_value|created_at|saved_models|bert-classifier-v1|sentiment-model-v3|lexivia\/notebook-gpu:latest|LR|Stanford University|en-US|short|numeric|2-digit|mine)$/i;
export function isUiText(value) {
  return typeof value === 'string' && /[a-zA-Z]{2}/.test(value.replace(/\{\w+\}/g,'')) && !technical.test(value.trim())
    && !/^(?:https?:|\/|\.|#|var\(|color-mix\(|rgba?\(|linear-gradient|data:|Bearer |[\w-]+\.(?:py|csv|json|wav|mp3|zip|txt|jsonl|pt|pkl|h5|onnx|ipynb)$)/i.test(value.trim())
    && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    && !/^(?:\d+px solid |skill-option|wizard-tab|er-badge|notif-(?:read|unread|selected)|solo-\{|TM$)/.test(value.trim())
    && !/=>|\b(?:import |def |print\(|function |const |return )|(?:background|font-size|display):/.test(value);
}
export async function collectUiStrings() {
  const found = new Map();
  function add(text,file,line,kind) {
    const normalized = normalizeMessage(text);
    if (!isUiText(text)) return;
    if (!found.has(normalized)) found.set(normalized,{text:text.replace(/\s+/g,' ').trim(),uses:[]});
    found.get(normalized).uses.push({file,line,kind});
  }
  async function scan(dir) {
    for (const entry of await fs.readdir(dir,{withFileTypes:true})) {
      const file = path.join(dir,entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'i18n') await scan(file); continue; }
      if (!/\.(jsx|js)$/.test(file) || /BrandLogo|firebase|supabase|theme\.js|__locale-qa/.test(file)) continue;
      const source = await fs.readFile(file,'utf8');
      const tree = parse(source,{sourceType:'module',plugins:['jsx']});
      function walk(node,parents=[]) {
        if (!node || typeof node !== 'object') return;
        const parent = parents.at(-1);
        const inCode = parents.some(p=>p.type==='JSXElement' && ['style','script','code','pre'].includes(p.openingElement.name?.name));
        if (inCode) return;
        const uiAssignment=parents.some(p=>p.type==='AssignmentExpression' && p.right.start<=node.start && node.end<=p.right.end && /^(?:errors|nextErrors|errs|validationErrors)$/.test(p.left?.object?.name||''));
        const uiMessageCall=parents.some(p=>p.type==='CallExpression' && (/^(?:set.*(?:Error|Err|Msg|Message)|alert|confirm|notify|toast|showToast|showNotify)$/.test(p.callee.name||'') || /^(?:notify|toast)$/.test(p.callee.object?.name||'')));
        if (node.type==='JSXText') add(node.value,file,node.loc.start.line,'jsx');
        if (node.type==='TemplateLiteral') {
          const attr = parents.findLast(p=>p.type==='JSXAttribute');
          const rendered = ['JSXExpressionContainer','ConditionalExpression','LogicalExpression'].includes(parent?.type) && parents.some(p=>p.type==='JSXExpressionContainer') && (!attr || displayAttributes.has(attr.name.name));
          const uiCall = parent?.type==='CallExpression' && /^(?:set.*(?:Error|Msg|Message)|alert|confirm|notify|toast|showToast|showNotify|__msg|t)$/.test(parent.callee.name || '');
          const error = parent?.type==='NewExpression' && parent.callee.name==='Error';
          const returned = parent?.type==='ReturnStatement' && /\s|^[A-Z]/.test(node.quasis.map(q=>q.value.cooked).join(''));
          if (rendered || uiCall || error || returned || uiAssignment || uiMessageCall) {
            const text=node.quasis.map((part,index)=>part.value.cooked+(index<node.expressions.length?`{value${index}}`:'' )).join('');
            add(text,file,node.loc.start.line,'template');
          }
        }
        if (node.type==='StringLiteral') {
          const rendered = parents.some(p=>p.type==='JSXExpressionContainer') && !parents.some(p=>p.type==='JSXAttribute' && !displayAttributes.has(p.name.name));
          const uiField = parent?.type==='ObjectProperty' && displayFields.has(parent.key.name || parent.key.value);
          const uiAttribute = parent?.type==='JSXAttribute' && displayAttributes.has(parent.name.name);
          const uiCall = parent?.type==='CallExpression' && /^(?:set.*(?:Error|Msg|Message)|alert|confirm|notify|toast|showToast|showNotify|__msg|t)$/.test(parent.callee.name || '');
          const error = parent?.type==='NewExpression' && parent.callee.name==='Error';
          const returned = ['ReturnStatement','ConditionalExpression'].includes(parent?.type) && parents.some(p=>p.type==='ReturnStatement') && /\s|^[A-Z]/.test(node.value);
          const comparison = parent?.type==='BinaryExpression' || parent?.type==='SwitchCase';
          if (!comparison && (rendered || uiField || uiAttribute || uiCall || error || returned || uiAssignment || uiMessageCall)) add(node.value,file,node.loc.start.line,uiField?'config':uiCall||error||returned?'message':'jsx');
        }
        for (const child of Object.values(node)) {
          if (Array.isArray(child)) child.forEach(n=>walk(n,[...parents,node]));
          else if (child && typeof child==='object') walk(child,[...parents,node]);
        }
      }
      walk(tree);
    }
  }
  await scan(path.resolve('src'));
  return [...found.values()];
}
const entries = await collectUiStrings();
const missing = entries.filter(entry=>!Object.hasOwn(catalogs.fr,normalizeMessage(entry.text)) || !Object.hasOwn(catalogs.ar,normalizeMessage(entry.text)));
await fs.mkdir('outputs/localization',{recursive:true});
await fs.writeFile('outputs/localization/missing.json',JSON.stringify(missing,null,2));
const filter = process.argv.slice(2).find(arg=>!arg.startsWith('--'));
if (filter) console.log(JSON.stringify(missing.filter(entry=>entry.uses.some(use=>use.file.toLowerCase().includes(filter.toLowerCase()))).map(entry=>entry.text),null,2));
else console.log(JSON.stringify({sourcePhrases:entries.length,missing:missing.length,files:[...new Set(missing.flatMap(entry=>entry.uses.map(use=>path.relative(process.cwd(),use.file))))]}));
if (process.argv.includes('--check') && missing.length) process.exitCode=1;
