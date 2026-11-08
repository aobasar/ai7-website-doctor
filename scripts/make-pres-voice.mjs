// Scene narration for the animated presentation, in the founder's voice clone (eleven_v3, with audio tags).
import fs from 'node:fs';
const KEY = process.env.ELEVENLABS_API_KEY, VOICE = process.env.ELEVENLABS_NARRATOR_VOICE_ID;
export const SCENES = [
  ['s1', "[clears throat] Hi, I'm Ahmet. Years ago I worked in a call center, fixing people's internet. I built a little form that told me the next question to ask. Today, I gave that form a voice."],
  ['s2', "When a small business's website breaks, it loses money every minute. [sighs] The owner waits on hold, repeats the story three times, and the ticket gets closed... while the site is still down."],
  ['s3', "Meet Website Doctor. Describe everything once. Maya, our AI specialist, sorts it by business impact, runs real tests, shows the evidence, and never calls it fixed until a re-test passes."],
  ['s4', "Here it is, live. Checkout is failing. Maya checks the DNS, the checkout page, then the server directly. The real culprit: the CDN is serving a cached error. [curious] And when the customer offers an API token..."],
  ['s5', "The customer purges the cache. Maya re-tests: two hundred, verified. Emails get the exact SPF and DMARC records on screen. And Wi-Fi goes to Nora, with full context."],
  ['s6', "Under the hood, ElevenLabs runs the live conversation and calls eight tools. Every check runs inside an isolated Daytona sandbox, a lab copy of the customer's stack, with fixed, read-only probes. And the server refuses 'resolved' without evidence."],
  ['s7', "Small businesses lose about four hundred dollars a minute when they're down. We start with hosting companies, web agencies and SaaS teams, who hear 'my site is down' every single day."],
  ['s8', "AI7 Tech Support. [excited] Don't just answer. Diagnose, resolve, verify."],
];
const out = await Promise.all(SCENES.map(async ([id, text]) => {
  for (const model of ['eleven_v3', 'eleven_multilingual_v2']) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: model === 'eleven_v3' ? text : text.replace(/\[[^\]]+\]\s*/g, ''), model_id: model }),
    });
    if (r.ok) { fs.writeFileSync(`AOB/video/pres/${id}.mp3`, Buffer.from(await r.arrayBuffer())); return `${id} ${model}`; }
    console.error(id, model, r.status, (await r.text()).slice(0, 200));
  }
  return `${id} FAILED`;
}));
console.log(out.join('\n'));
