// Word-level timestamps for each pitch audio clip via ElevenLabs Speech-to-Text (Scribe).
// Output: AOB/video/pres/words_<scene>.json  [{w, s, e}]
import fs from 'node:fs';
const KEY = process.env.ELEVENLABS_API_KEY, D = 'AOB/video/pres';
const TL = JSON.parse(fs.readFileSync(`${D}/timeline.json`, 'utf8'));
for (const s of TL) {
  const fd = new FormData();
  fd.append('model_id', 'scribe_v1');
  fd.append('file', new Blob([fs.readFileSync(`${D}/${s.audio}`)]), s.audio);
  fd.append('timestamps_granularity', 'word');
  if (s.id === 's4b') fd.append('diarize', 'true');
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': KEY }, body: fd });
  if (!r.ok) { console.error(s.id, r.status, (await r.text()).slice(0, 200)); continue; }
  const j = await r.json();
  const words = (j.words || []).filter((w) => w.type === 'word').map((w) => ({ w: w.text, s: w.start, e: w.end, sp: w.speaker_id }));
  fs.writeFileSync(`${D}/words_${s.id}.json`, JSON.stringify(words));
  console.log(s.id, words.length, 'words', words.slice(0, 4).map((x) => x.w).join(' '));
}
