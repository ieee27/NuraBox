#!/usr/bin/env node
/*
  Nura Box - tools/build-esp.js
  Packs the website for the ESP32's LittleFS. Needs only Node (built-ins, no npm install).

    node tools/build-esp.js          -> option (c): ONE file  firmware/nura_esp32/data/index.html.gz   (recommended)
    node tools/build-esp.js --split  -> option (a): copies index.html + css/ + js/ as-is into data/    (debug / no Node gzip needed)

  Why one gzipped file: the ESP32 WebServer is single-threaded, so 8 separate requests are served one after another.
  One ~25 KB gzip = 1 request, less flash, faster first paint. The firmware serves "<path>.gz" automatically.
  Trade-off: you must re-run this script (and re-upload LittleFS) after EVERY website change; the split site in the repo stays the source of truth.
  CDN scripts (Chart.js, mqtt.js, Tajawal) stay external: with no internet the site still works (chart falls back to CSS bars, system font).
*/
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'firmware', 'nura_esp32', 'data');
const split = process.argv.includes('--split');

function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

rm(OUT);
fs.mkdirSync(OUT, { recursive: true });

if (split) {
  fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(OUT, 'index.html'));
  copyDir(path.join(ROOT, 'css'), path.join(OUT, 'css'));
  copyDir(path.join(ROOT, 'js'), path.join(OUT, 'js'));
  console.log('split copy done ->', OUT);
  process.exit(0);
}

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 1) CSS -> <style>
html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (m, p) => {
  const css = fs.readFileSync(path.join(ROOT, p), 'utf8');
  return '<style>\n' + css + '\n</style>';
});

// 2) local <script defer src="js/..."> -> one inline script (same order); CDN tags are untouched
const files = [];
html = html.replace(/<script defer src="(js\/[^"]+)"><\/script>\s*/g, (m, p) => { files.push(p); return ''; });
if (!files.length) { console.error('no local scripts found in index.html'); process.exit(1); }
const js = files.map((p) => '/* ' + p + ' */\n' + fs.readFileSync(path.join(ROOT, p), 'utf8')).join('\n').replace(/<\/script/gi, '<\\/script');
html = html.replace('</body>', '<script>\n' + js + '\n</script>\n</body>');   // end of body: DOM exists, deferred CDN scripts still run before DOMContentLoaded -> boot()

const gz = zlib.gzipSync(Buffer.from(html, 'utf8'), { level: 9 });
fs.writeFileSync(path.join(OUT, 'index.html.gz'), gz);
console.log('bundled', files.length, 'scripts + css');
console.log('index.html  ' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB  ->  index.html.gz  ' + (gz.length / 1024).toFixed(1) + ' KB');
console.log('output:', path.join(OUT, 'index.html.gz'));
