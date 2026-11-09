// Records the animated pitch (AOB/video/pres/index.html) with the installed Chrome,
// then lays the narration and the live-call audio under it.
// Run from the repo root: node scripts/make-pres.mjs
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const D = 'AOB/video/pres';
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
const GAP = 0.45, LEAD = 0.8;
// scene id, audio file
const ORDER = [['s1', 's1.mp3'], ['s2', 's2.mp3'], ['s3', 's3.mp3'], ['s4', 's4.mp3'], ['s4b', 'token.wav'], ['s5', 's5.mp3'], ['s6', 's6.mp3'], ['s7b', 's7b.mp3'], ['s8', 's8.mp3']];
let t = LEAD;
const TL = ORDER.map(([id, a]) => { const d = dur(`${D}/${a}`); const s = { id, audio: a, start: +t.toFixed(2), dur: d }; t += d + GAP; return s; });
const total = t + 1.5;
// Captions + speaker badges per scene.
const voiceSrc = fs.readFileSync('scripts/make-pres-voice.mjs', 'utf8');
const TXT = {}; for (const m of voiceSrc.matchAll(/\['(s\d)', "([^"]+)"\]/g)) TXT[m[1]] = m[2].replace(/\[[^\]]+\]\s*/g, '');
TXT.s7b = "So, in one call: checkout was down and losing sales. Fixed, and verified, in under a minute. Order emails were landing in spam. The records are fixed and re-checked. And the Wi-Fi was measured honestly, and escalated with evidence. No hold music. No guesswork.";
const chunk = (txt, start, d) => { const w = txt.split(/\s+/); const cs = []; for (let k = 0; k < w.length; k += 8) cs.push(w.slice(k, k + 8).join(' ')); const st = d / cs.length; return cs.map((c, j) => ({ t: +(start + j * st).toFixed(2), d: +(st - 0.05).toFixed(2), text: c })); };
const FIX = { Ahmed: 'Ahmet', "Ahmed,": 'Ahmet,', "Ahmed.": 'Ahmet.', tech: 'Tech', support: 'Support', 'support.': 'Support.' };
for (const s of TL) {
  const wf = `${D}/words_${s.id}.json`;
  const words = fs.existsSync(wf) ? JSON.parse(fs.readFileSync(wf, 'utf8')) : [];
  if (s.id === 's8') words.forEach((w, i) => { if (i < 3 && FIX[w.w]) w.w = FIX[w.w]; });
  words.forEach((w) => { if (/^Ahmed/.test(w.w)) w.w = w.w.replace('Ahmed', 'Ahmet'); });
  const caps = []; let cur = null;
  const firstSp = words[0]?.sp;
  words.forEach((w, i) => {
    const who = s.id === 's4b' ? (w.sp === firstSp ? 'Customer' : 'Maya') : 'Narrator';
    if (!cur || cur.words.length >= 9 || (cur.who !== who) || (/[.?!]$/.test(words[i - 1]?.w || '') && cur.words.length >= 3)) {
      cur = { t: w.s, who, words: [] }; caps.push(cur);
    }
    cur.words.push({ w: w.w, t: +w.s.toFixed(2) });
    cur.end = w.e;
  });
  caps.forEach((c, i) => { c.d = +(((caps[i + 1]?.t ?? c.end + 0.4) - c.t) - 0.02).toFixed(2); c.t = +c.t.toFixed(2); });
  s.caps = caps;
  if (s.id === 's4b') {
    const mayaAt = caps.find((c) => c.who === 'Maya')?.t ?? 6.4;
    s.badges = [{ t: 0, kind: 'cust', text: 'LIVE CALL · Customer (voice clone)' }, { t: mayaAt, kind: 'agent', text: 'LIVE CALL · AI AGENT · Maya' }];
  } else {
    s.badges = ['s4', 's5'].includes(s.id) ? [{ t: 0, kind: 'live', text: 'LIVE DEMO footage · NARRATOR: Ahmet' }] : [{ t: 0, kind: 'narr', text: 'NARRATOR · Ahmet (founder)' }];
  }
}
fs.writeFileSync(`${D}/timeline.json`, JSON.stringify(TL, null, 2));
console.log('total', total.toFixed(1), 's');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: `${D}/raw`, size: { width: 1920, height: 1080 } } });
const page = await ctx.newPage();
const t0 = Date.now();
await page.goto('file://' + process.cwd() + `/${D}/index.html`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
const startOffset = (Date.now() - t0) / 1000; // video time when the show starts
await page.evaluate((tl) => { window.TIMELINE = tl; window.startShow(); }, TL);
await page.waitForTimeout(total * 1000);
const vpath = await page.video().path();
await ctx.close(); await browser.close();
console.log('raw video', vpath, 'show starts at', startOffset.toFixed(2));

// Audio: each scene's audio at its start time.
const inputs = [], fc = [];
TL.forEach((s, i) => {
  inputs.push('-i', `${D}/${s.audio}`);
  const ms = Math.round(s.start * 1000);
  fc.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}:all=1[a${i}]`);
});
fc.push(TL.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${TL.length}:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5[aout]`);
execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', fc.join(';'), '-map', '[aout]', '-t', String(total), `${D}/audio.wav`]);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(startOffset), '-i', vpath, '-i', `${D}/audio.wav`, '-map', '0:v', '-map', '1:a', '-t', String(total),
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', 'AOB/video/website-doctor-pitch.mp4']);
console.log('done AOB/video/website-doctor-pitch.mp4', dur('AOB/video/website-doctor-pitch.mp4').toFixed(1), 's');
