// 将审核原型内嵌为单文件，供离线直接打开；不属于正式门户构建。
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const [html, css, icons, patterns, app] = await Promise.all(
  ['index.html', 'styles.css', 'icons.js', 'interaction-patterns.js', 'app.js'].map((name) => readFile(join(directory, name), 'utf8')),
);
const script = [
  icons.replace('export const icons', 'const icons'),
  patterns.replace('export function mountInteractionPatterns', 'function mountInteractionPatterns'),
  app.replace("import { icons } from './icons.js';", '').replace("import { mountInteractionPatterns } from './interaction-patterns.js';", ''),
].join('\n');
const bundled = html
  .replace('<link rel="stylesheet" href="./styles.css" />', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="./app.js"></script>', `<script type="module">\n${script}\n</script>`);
await writeFile(join(directory, 'review.html'), bundled);
console.log('Offline review.html generated.');
