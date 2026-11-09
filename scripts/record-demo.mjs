// Records a full live demo of the hosted app in Chrome (Playwright video, 1920x1080):
// sign in (prefilled), intake, triage, demo caller, live call with Maya and Nora, summary.
// Writes AOB/video/demo-rec/<file>.webm and demo-rec/meta.json with the call offset.
// Run: node scripts/record-demo.mjs [url]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = process.argv[2] || 'https://ai7tech.aobasar.com';
const OUT = 'AOB/video/demo-rec';
fs.rmSync(OUT, { recursive: true, force: true });
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } }, permissions: ['microphone'] });
const page = await ctx.newPage();
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6), ...a);

await page.goto(URL + '/login');
await page.click('button[type=submit]');
await page.waitForSelector('text=Start Support');
await page.waitForTimeout(1500);
await page.click('text=Start Support');
await page.waitForTimeout(1800);
await page.check('#consent');
await page.check('#democaller');
await page.waitForTimeout(700);
await page.click('text=Start voice session');
log('call started');
await page.waitForSelector('.msgs li.agent-m', { timeout: 30000 });
const firstAgent = (Date.now() - t0) / 1000;
log('first agent line');

// Follow the call until the summary appears (or 5 min).
let last = '';
const deadline = Date.now() + 300000;
while (Date.now() < deadline) {
  if (await page.locator('h1:has-text("Case summary")').count()) break;
  const st = await page.evaluate(() => [...document.querySelectorAll('.issues li')].map((l) => l.innerText.replace(/\s+/g, ' ')).join(' | '));
  if (st !== last) { log(st); last = st; }
  await page.waitForTimeout(1000);
}
log('summary');
await page.waitForTimeout(2500);
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 380); await page.waitForTimeout(1600); }
await page.waitForTimeout(1000);
const video = await page.video().path();
await ctx.close(); await browser.close();
// Call second 0 ≈ first agent line minus ~0.4 s (the greeting text arrives just after the call starts).
fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify({ video, callOffset: +(firstAgent - 0.4).toFixed(2) }, null, 2));
log('saved', video, 'callOffset', (firstAgent - 0.4).toFixed(2));
