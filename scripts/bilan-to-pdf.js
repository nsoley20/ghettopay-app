import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(resolve(__dirname, '../BILAN.md'), 'utf8');

// Convertir le markdown en HTML simple
const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;500;700&family=DM+Mono:wght@400&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', system-ui, sans-serif; font-size: 12px; color: #1a1a1a; padding: 2.5cm 2cm; line-height: 1.6; }
  h1 { color: #0A4A2E; font-size: 22px; margin-bottom: 4px; }
  h2 { color: #0A4A2E; font-size: 14px; margin-top: 24px; margin-bottom: 8px; border-bottom: 1px solid #d1fae5; padding-bottom: 4px; }
  h3 { font-size: 12px; margin-top: 14px; margin-bottom: 6px; color: #374151; }
  p { margin-bottom: 8px; }
  blockquote { color: #666; font-style: italic; margin-bottom: 12px; }
  ul, ol { padding-left: 20px; margin-bottom: 8px; }
  li { margin-bottom: 3px; }
  code { font-family: 'DM Mono', monospace; background: #f3f4f6; padding: 1px 5px; border-radius: 3px; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 16px; font-size: 11px; }
  th { background: #0A4A2E; color: white; padding: 6px 10px; text-align: left; }
  td { padding: 5px 10px; border-bottom: 1px solid #e5e7eb; }
  tr:nth-child(even) td { background: #f9fafb; }
  hr { border: none; border-top: 1px solid #d1fae5; margin: 20px 0; }
  a { color: #0A4A2E; }
  input[type=checkbox] { margin-right: 6px; }
</style>
</head>
<body>
${convertMd(md)}
</body>
</html>`;

function convertMd(text) {
  return text
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^---$/gm, '<hr/>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[x\]/gi, '<input type="checkbox" checked disabled>')
    .replace(/\[ \]/g, '<input type="checkbox" disabled>')
    .replace(/^\| (.+)$/gm, (_, row) => {
      const cells = row.split(' | ');
      return '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>';
    })
    .replace(/(<tr>.*<\/tr>\n)+/gs, m => '<table>' + m.replace(/<td>(---|:---:|---:)<\/td>/g, '').replace(/(<tr>(?:<td>[^<]*<\/td>)+<\/tr>\n)/, r => r.replace(/<td>/g, '<th>').replace(/<\/td>/g, '</th>')) + '</table>')
    .replace(/^- \[/gm, '<li style="list-style:none">- [')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, m => '<ul>' + m + '</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hupbtri])(.+)$/gm, '$1');
}

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.pdf({
  path: resolve(__dirname, '../BILAN.pdf'),
  format: 'A4',
  margin: { top: '1cm', bottom: '1cm', left: '0cm', right: '0cm' },
  printBackground: true,
});
await browser.close();
console.log('BILAN.pdf généré.');
