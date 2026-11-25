import fs from 'node:fs/promises';
import path from 'node:path';
import {parse} from '@babel/parser';
import postcss from 'postcss';
import themeColors,{themeValue} from './themeColors.js';

export function colorRole(prop) {
 if (/^(?:background|backgroundColor|bg)$/.test(prop))return 'surface';
 if (/^(?:color|text|caretColor|textDecorationColor)$/.test(prop))return 'text';
 if (/^(?:border|outline)(?:[A-Z]|$)/.test(prop))return 'border';
 return null;
}
export async function themeAudit(fix=false) {
 const issues=[];
 async function visit(dir) {
  for(const item of await fs.readdir(dir,{withFileTypes:true})) {
   const file=path.join(dir,item.name);
   if(item.isDirectory()){if(item.name!=='i18n')await visit(file);continue;}
   if(!/\.(jsx|js)$/.test(file)||/BrandLogo|theme\.js|__.*qa/.test(file))continue;
   const source=await fs.readFile(file,'utf8');
   const tree=parse(source,{sourceType:'module',plugins:['jsx']});const edits=[];
   async function walk(node,parents=[]) {
    if(!node||typeof node!=='object')return;
    const parent=parents.at(-1);
    if(node.type==='JSXElement'&&node.openingElement.name?.name==='style') {
     const expr=node.children.find(child=>child.type==='JSXExpressionContainer')?.expression;
     const binding=expr?.type==='Identifier'?tree.program.body.find(statement=>statement.type==='VariableDeclaration'&&statement.declarations.some(decl=>decl.id.name===expr.name)):null;
     const template=expr?.type==='TemplateLiteral'?expr:binding?.declarations.find(decl=>decl.id.name===expr.name)?.init;
     if(template?.type==='TemplateLiteral'&&!template.expressions.length) {
      const css=template.quasis[0].value.cooked;
      const compiled=(await postcss([themeColors()]).process(css,{from:undefined})).css;
      if(css!==compiled) {
       issues.push({file: path.relative(process.cwd(),file),line:node.loc.start.line,kind:'embedded CSS'});
       if(fix) {
        const cssName=path.basename(file,'.jsx')+'.theme.css';
        await fs.writeFile(path.resolve('src/styles',cssName),css.trim()+'\n');
        let relative=path.relative(path.dirname(file),path.resolve('src/styles',cssName)).replaceAll('\\','/');if(!relative.startsWith('.'))relative='./'+relative;
        edits.push({start:0,end:0,text:`import '${relative}';\n`},{start:node.start,end:node.end,text:''});
        if(binding)edits.push({start:binding.start,end:binding.end,text:''});
       }
      }
     }
     return;
    }
    if(node.type==='StringLiteral'&&!node.value.includes('var(--lx-')) {
     const prop=[...parents].reverse().find(p=>p.type==='ObjectProperty');
     const attribute=parent?.type==='JSXAttribute'?parent:null;
     const role=colorRole(attribute?.name?.name||prop?.key?.name||prop?.key?.value||'');
     if(role) {
      const next=themeValue(node.value,role);
      if(next!==node.value) {
       issues.push({file:path.relative(process.cwd(),file),line:node.loc.start.line,kind:'inline color',value:node.value});
       if(fix)edits.push({start:node.start,end:node.end,text:attribute?`{${JSON.stringify(next)}}`:JSON.stringify(next)});
      }
     }
    }
    for(const value of Object.values(node)) {
     if(Array.isArray(value)){for(const child of value)await walk(child,[...parents,node]);}
     else if(value&&typeof value==='object')await walk(value,[...parents,node]);
    }
   }
   await walk(tree);
   if(edits.length){let next=source;for(const edit of edits.sort((a,b)=>b.start-a.start))next=next.slice(0,edit.start)+edit.text+next.slice(edit.end);await fs.writeFile(file,next);}
  }
 }
 await visit(path.resolve('src'));
 return issues;
}
const issues=await themeAudit(process.argv.includes('--fix'));
await fs.mkdir('outputs/theme-audit',{recursive:true});
await fs.writeFile('outputs/theme-audit/report.json',JSON.stringify(issues,null,2));
console.log(JSON.stringify({issues:issues.length,files:[...new Set(issues.map(issue=>issue.file))]}));
if(process.argv.includes('--check')&&issues.length)process.exitCode=1;
