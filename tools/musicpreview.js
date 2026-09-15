// ============================================================================
// Render every soundtrack track to a WAV preview with an OfflineAudioContext in
// headless Chromium (Web Audio is browser-only), so the music can be heard
// without playing a race.
//
//   node tools/musicpreview.js [outdir] [--bars 8] [--rate 44100]     default docs/music
// ============================================================================

import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'fs';
import { createServer } from '../server/index.js';
import { Lobby } from '../server/lobby.js';

const OUT = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : new URL('../docs/music', import.meta.url).pathname;
const barsIdx = process.argv.indexOf('--bars');
const BARS = barsIdx > 0 ? parseInt(process.argv[barsIdx + 1], 10) : 8;
const rateIdx = process.argv.indexOf('--rate');
const RATE = rateIdx > 0 ? parseInt(process.argv[rateIdx + 1], 10) : 44100;
mkdirSync(OUT, { recursive: true });
const { server } = createServer(new Lobby());
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/agrav/`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', e => console.error('pageerror', e.message));
await page.goto(base + 'index.html?lite=1', { waitUntil: 'load' });
const list = await page.evaluate(async ([bars, rate]) => {
  const { TRACKS, renderTrack } = await import('./src/music.js');
  const out = [];
  for (const t of TRACKS) {
    const buf = await renderTrack(t, bars, rate);
    // interleave to 16-bit PCM and wrap in a WAV header
    const n = buf.length, ch = buf.numberOfChannels, data = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); data.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
    data.setUint32(24, buf.sampleRate, true); data.setUint32(28, buf.sampleRate * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true); str(36, 'data'); data.setUint32(40, n * ch * 2, true);
    let peak = 0, sum = 0; const chans = []; for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, chans[c][i])); peak = Math.max(peak, Math.abs(v)); sum += v * v; data.setInt16(44 + (i * ch + c) * 2, v * 32767, true); }
    const bytes = new Uint8Array(data.buffer); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    out.push({ id: t.id, title: t.title, bpm: t.bpm, seconds: +(n / buf.sampleRate).toFixed(1), peak: +peak.toFixed(2), rms: +Math.sqrt(sum / (n * ch)).toFixed(3), b64: btoa(bin) });
  }
  return out;
}, [BARS, RATE]);
for (const t of list) {
  const file = `${OUT}/${t.id}.wav`;
  writeFileSync(file, Buffer.from(t.b64, 'base64'));
  console.log(`wrote ${file}  ${t.title} · ${t.bpm} bpm · ${t.seconds} s · peak ${t.peak} · rms ${t.rms}`);
}
await browser.close(); server.close(); process.exit(0);
