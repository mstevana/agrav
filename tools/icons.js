// Renders the AGRAV app icons (192 and 512 px PNG) from an inline SVG with
// headless Chromium, so the repo carries no binary-producing toolchain.
//   node tools/icons.js
import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1030"/><stop offset="1" stop-color="#05060c"/></linearGradient>
  <filter id="glow"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
  <rect width="512" height="512" rx="96" fill="url(#g)"/>
  <path d="M256 84 L392 400 L256 344 L120 400 Z" fill="#2df1ff" filter="url(#glow)"/>
  <path d="M256 150 L340 372 L256 330 L172 372 Z" fill="#05060c"/>
  <path d="M256 200 L300 340 L256 318 L212 340 Z" fill="#ff2d95"/>
  <rect x="96" y="428" width="320" height="14" rx="7" fill="#2df1ff" opacity="0.7"/>
</svg>`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:transparent">${svg(size)}</body>`);
  const buf = await page.screenshot({ omitBackground: true, type: 'png' });
  writeFileSync(new URL(`../agrav/icons/icon-${size}.png`, import.meta.url), buf);
  await page.close();
  console.log(`icon-${size}.png ${buf.length} bytes`);
}
await browser.close();
