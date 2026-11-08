// Downloads the latest Maya conversation (audio + timed transcript) for video editing.
// Run: node --env-file=.env.local scripts/fetch-conversation.mjs [conversation_id]
import fs from 'node:fs';
const KEY = process.env.ELEVENLABS_API_KEY, AGENT = process.env.ELEVENLABS_AGENT_ID;
const H = { 'xi-api-key': KEY };
let id = process.argv[2];
if (!id) {
  const list = await fetch(`https://api.elevenlabs.io/v1/convai/conversations?agent_id=${AGENT}&page_size=5`, { headers: H }).then((r) => r.json());
  for (const c of list.conversations || []) console.log(c.conversation_id, c.status, c.call_duration_secs + 's', new Date(c.start_time_unix_secs * 1000).toISOString());
  id = list.conversations?.[0]?.conversation_id;
}
const conv = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${id}`, { headers: H }).then((r) => r.json());
fs.mkdirSync('AOB/video', { recursive: true });
fs.writeFileSync(`AOB/video/${id}.json`, JSON.stringify(conv, null, 2));
const a = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${id}/audio`, { headers: H });
console.log('audio', a.status, a.headers.get('content-type'));
if (a.ok) fs.writeFileSync(`AOB/video/${id}.mp3`, Buffer.from(await a.arrayBuffer()));
const t = (conv.transcript || []).map((m) => `${String(m.time_in_call_secs).padStart(4)}s ${m.role.padEnd(5)} ${(m.message || (m.tool_calls?.length ? '[tool ' + m.tool_calls.map((x) => x.tool_name).join(',') + ']' : '')).slice(0, 90)}`);
console.log('id', id, 'status', conv.status, 'duration', conv.metadata?.call_duration_secs);
console.log(t.join('\n'));
