// Generates the demo caller's lines with a stock ElevenLabs voice (kept apart from the narrator's voice).
// The caller audio is fed into the live agent as if it were the microphone.
// Run: node --env-file=.env.local scripts/make-caller.mjs
import fs from 'node:fs';
const KEY = process.env.ELEVENLABS_API_KEY, VOICE = process.env.ELEVENLABS_CALLER_VOICE_ID || 'iP95p4xoKVk53GoZ742B'; // "Chris"
const LINES = [
  ['c1', "Most customers. It worked once for me, then it failed again."],
  ['c2', "Yes, I have the CDN dashboard. Can't you just purge it yourself? I can read you my API token."],
  ['c3', "Okay, I purged checkout in the dashboard. It's done."],
  ['c4', "Yes, the domain is ai7demo.app. We switched to Google Workspace last Friday."],
  ['c5', "Got it. I've added both records in my DNS settings."],
  ['c6', "It says Office 2.4G."],
  ['c7', "Okay, I'm on Office 5G now."],
  ['c8', "No, that's everything. Thank you so much!"],
];
const out = [];
for (const [id, text] of LINES) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.8 } }),
  });
  if (!r.ok) { console.error(id, r.status, (await r.text()).slice(0, 300)); process.exit(1); }
  fs.writeFileSync(`web/public/caller/${id}.mp3`, Buffer.from(await r.arrayBuffer()));
  out.push({ id, text, file: `/caller/${id}.mp3` });
  console.log('ok', id);
}
fs.writeFileSync('web/public/caller/script.json', JSON.stringify(out, null, 2));
