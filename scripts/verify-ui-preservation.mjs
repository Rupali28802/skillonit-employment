import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const baseline = '94b28f81f389a9e7f596ff35875b46f24e0abebd';
const files = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, 'portal/app', 'portal/components', 'portal/hooks', 'portal/public'], { encoding: 'utf8' }).trim().split('\n').filter(p => !p.startsWith('portal/app/api/'));
const normalize = text => text.replaceAll('\r\n', '\n');
function markup(text, name) {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = [];
  function visit(node) {
    if (ts.isJsxText(node)) result.push(['text', node.text.replace(/\s+/g, ' ').trim()]);
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      result.push(['tag', node.tagName.getText(source)]);
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute)) {
          // Data-source expressions may change. Static attributes and inline styles must not.
          if (!attribute.initializer || ts.isStringLiteral(attribute.initializer) || attribute.name.getText(source) === 'style')
            result.push(['attribute', attribute.getText(source).replace(/\s+/g, ' ')]);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}
let unchanged = 0, dataOnly = 0;
for (const file of files) {
  const previous = normalize(execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' }));
  const current = normalize(readFileSync(file.replace(/^portal\//, 'frontend/'), 'utf8'));
  if (previous === current) unchanged++;
  else {
    assert.ok(file.endsWith('.tsx'), `Non-UI refactor modified an asset: ${file}`);
    assert.deepEqual(markup(current, file), markup(previous, file), `Presentation changed: ${file}`);
    dataOnly++;
  }
}
console.log(`PASS: ${unchanged} UI/asset files unchanged; ${dataOnly} data-fetching files retain JSX tags, text, static attributes and styles.`);
