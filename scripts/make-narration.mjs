// Generates the demo-video narration in the founder's voice clone, plus an .srt
// built from ElevenLabs character timestamps. Output: AOB/video/<part>.mp3 / .srt
// Run: node --env-file=.env.local scripts/make-narration.mjs
import fs from 'node:fs';
const KEY = process.env.ELEVENLABS_API_KEY, VOICE = process.env.ELEVENLABS_NARRATOR_VOICE_ID;
const PARTS = {
  intro: "When a small business's website breaks, it loses money every minute. Owners wait on hold, repeat themselves to three departments, and tickets get closed while the site is still down. I used to do this job in a call center. So I built Website Doctor: a voice AI support desk that doesn't guess. It tests, it fixes, and it verifies.",
  outro: "Under the hood, ElevenLabs runs the live conversation, and Maya calls tools while she talks. Every check runs in an isolated Daytona sandbox: a lab copy of the customer's stack, with a real caching proxy and real DNS. The agent can only pick approved, read-only checks. It refuses passwords and tokens, and the server won't accept resolved without a passing re-test. Next, we add more specialists and verified checks on real customer domains, so hosting companies and agencies can offer this to their own customers. AI7 Tech Support. Don't just answer. Diagnose, resolve, verify.",
};
const t = (s) => { const ms = Math.round(s * 1000); const h = String(Math.floor(ms / 3600000)).padStart(2, '0'); const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0'); const sec = String(Math.floor(ms / 1000) % 60).padStart(2, '0'); return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, '0')}`; };
for (const [name, text] of Object.entries(PARTS)) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.55, similarity_boost: 0.8 } }),
  });
  if (!r.ok) { console.error(name, r.status, (await r.text()).slice(0, 300)); process.exit(1); }
  const j = await r.json();
  fs.writeFileSync(`AOB/video/${name}.mp3`, Buffer.from(j.audio_base64, 'base64'));
  const a = j.alignment; const chars = a.characters;
  // Cue per sentence, split further if longer than ~8 words.
  const cues = []; let start = null, buf = '';
  chars.forEach((c, i) => {
    if (start === null && c.trim()) start = a.character_start_times_seconds[i];
    buf += c;
    const words = buf.trim().split(/\s+/).length;
    if (/[.:!?]/.test(c) || (c === ',' && words >= 6) || (c === ' ' && words >= 10) || i === chars.length - 1) {
      if (buf.trim()) cues.push([start, a.character_end_times_seconds[i], buf.trim()]);
      start = null; buf = '';
    }
  });
  fs.writeFileSync(`AOB/video/${name}.srt`, cues.map(([s, e, x], k) => `${k + 1}\n${t(s)} --> ${t(e)}\n${x}\n`).join('\n'));
  console.log(name, `${a.character_end_times_seconds.at(-1).toFixed(1)} s`, `${cues.length} cues`);
}
