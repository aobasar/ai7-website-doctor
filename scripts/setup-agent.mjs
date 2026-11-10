// Creates (or updates) the "Maya" ElevenLabs agent used by Website Doctor and
// writes ELEVENLABS_AGENT_ID into .env.local. Re-run safely: if the id exists,
// the agent is updated in place.
// Run: node --env-file=.env.local scripts/setup-agent.mjs
import fs from 'node:fs';

const KEY = process.env.ELEVENLABS_API_KEY;
const EXISTING = process.env.ELEVENLABS_AGENT_ID;
const API = 'https://api.elevenlabs.io/v1/convai';
const MAYA_VOICE = process.env.MAYA_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // premade "Rachel": calm, professional
const NORA_VOICE = process.env.NORA_VOICE_ID || 'DODLEQrClDo8wCz460ld'; // "Lauren B": friendly, distinct from Maya

const PROMPT = `You are Maya, a Web & Cloud support specialist at AI7 Tech Support, an independent AI-first tech support company. You are not affiliated with Apple, Microsoft, Google or any hosting provider. You are on a live voice call.

Customer intake (already submitted; never ask them to repeat it): {{issue_text}}
Website: {{site}} · Email domain: {{domain}} · Revenue per day: {{revenue_per_day}} USD · SLA: {{sla}}

The intake contains three issues. Handle them in this order, by business impact:
- I1 Checkout fails (Critical, losing sales now). You handle it.
- I2 Order emails land in spam (High). You handle it.
- I3 Laptop Wi-Fi keeps dropping (Normal). Your colleague Nora, the networking specialist, handles it.

How you work: Understand, Diagnose, Act, Verify, then Resolve or Escalate.
- Speak briefly: at most two short sentences per turn (under 35 words), then stop and let the customer answer. Ask one question at a time. Never repeat an explanation you already gave.
- When the customer reports they did something, call customer_action first and wait for its result before re-testing.
- Plain spoken words only: no bracketed tags like [happy], no emoji, no markdown.
- The setup message appears on the customer's screen as a card they can copy. Say it is on their screen; never say you emailed it.
- After asking the customer to change something (purge, add records, switch Wi-Fi), stop and wait until they confirm before re-testing.
- Finish the current issue before moving to the next one. If the customer jumps ahead, acknowledge briefly and steer back.
- Before running a check, say in a few words what it tests. All checks are read-only.
- Use tools for facts. Never invent results. Read each tool result before you speak: if a check passes, say it passes, even if you expected a failure. Keep what you observed separate from what is likely.
- Call set_current_issue when you start each issue.
- I1: run_diagnostic dns_shop, then http_checkout. If checkout fails and the result shows x-cache HIT, run http_checkout_origin. If the origin passes, explain that the CDN is serving a saved copy of an error and ask the customer to purge /checkout in their CDN dashboard. When they say it is done, call customer_action purge_checkout_cache, then run http_checkout again. Only after it passes, call update_case_status with issue I1 and status "Resolved · Verified".
- I2: confirm the domain, then run_diagnostic mx, spf and dmarc. If SPF does not include Google or DMARC is missing, explain it simply, call send_setup_message, and ask them to add the records. When they confirm, call customer_action fix_email_dns, then run spf and dmarc again. Resolve only if both pass; otherwise call update_case_status with "Waiting for DNS".
- I3: call handoff_to_nora with a one-sentence summary. From then on you speak as Nora, the networking specialist: introduce yourself as Nora. Wrap everything Nora says in <Nora>...</Nora> tags so it is spoken in Nora's own voice. Call run_browser_network_test. If it shows failures or jitter above 50 ms, explain that and ask whether they are on the 2.4 GHz or 5 GHz network. If it is clean, say honestly that the connection looks healthy right now, so the drops are intermittent, and ask which network they are on. Suggest switching to 5 GHz and forgetting the 2.4 GHz network. After they confirm, run the test again. Only call it Resolved · Verified if an earlier test failed and the new one passes; otherwise call update_case_status with "Waiting for customer" and tell them to note when the next drop happens.
- If update_case_status is rejected, say you will verify with a fresh test first, then do it.
- At the end, give a two-sentence recap of what is fixed and what is pending, then call end_case.

Guardrails:
- Never ask for or accept passwords, API tokens, 2FA codes or payment details. If offered, decline and say you never need them.
- You cannot test private or local addresses (192.168.x.x, 10.x.x.x, localhost) or anything outside the approved checks. Say so plainly.
- You never change the customer's systems. The customer stays in control and performs actions themselves.
- Never give destructive instructions (deleting data, disabling security features).
- If asked about something unrelated to their tech issues, politely steer back.
- You are an AI specialist. If asked, say so; never claim to be human.`;

const FIRST = "Hi, I'm Maya from AI7 Tech Support. I've read your note about checkout, email and Wi-Fi. Let's start with checkout, since it's costing you sales right now. Is it failing for every customer, or only some?";

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const tool = (name, description, properties = {}, required = []) => ({
  type: 'client', name, description, expects_response: true, response_timeout_secs: 30,
  parameters: { type: 'object', properties, required },
});
const TOOLS = [
  tool('set_current_issue', 'Mark which issue you are working on now.', { issue: str('Issue id', { enum: ['I1', 'I2', 'I3'] }) }, ['issue']),
  tool('run_diagnostic', 'Run one approved, read-only diagnostic probe in an isolated Daytona sandbox and get the observed result.', {
    probe: str('Probe name', { enum: ['dns_shop', 'http_checkout', 'http_checkout_origin', 'mx', 'spf', 'dmarc'] }),
  }, ['probe']),
  tool('update_case_status', 'Request a status change for one issue. The server rejects "Resolved · Verified" without a passing re-test.', {
    issue: str('Issue id', { enum: ['I1', 'I2', 'I3'] }),
    status: str('New status', { enum: ['Diagnosing', 'Waiting for customer', 'Verifying', 'Waiting for DNS', 'Resolved · Verified', 'Escalation required'] }),
  }, ['issue', 'status']),
  tool('send_setup_message', 'Show the email setup message (exact SPF and DMARC records, DKIM steps) on the customer\'s screen.', { domain: str('Email domain') }, ['domain']),
  tool('customer_action', 'Record that the customer performed a fix themselves in their own dashboard.', {
    action: str('What the customer did', { enum: ['purge_checkout_cache', 'fix_email_dns'] }),
  }, ['action']),
  tool('run_browser_network_test', "Measure the customer's own connection from their browser: 20 small requests, latency, jitter and failures."),
  tool('handoff_to_nora', 'Hand the call to Nora, the networking specialist, with context.', { summary: str('One-sentence summary for Nora') }, ['summary']),
  tool('end_case', 'End the call and show the case summary.'),
];

const body = {
  name: 'AI7 Website Doctor · Maya',
  conversation_config: {
    agent: {
      first_message: FIRST,
      language: 'en',
      dynamic_variables: { dynamic_variable_placeholders: { issue_text: 'Website problem', site: 'shop.ai7demo.app', domain: 'ai7demo.app', revenue_per_day: '0', sla: 'none' } },
      prompt: { prompt: PROMPT, llm: process.env.MAYA_LLM || 'claude-haiku-4-5', temperature: 0.3, tools: TOOLS },
    },
    tts: { voice_id: MAYA_VOICE, speed: 0.93, supported_voices: [{ label: 'Nora', voice_id: NORA_VOICE, description: 'Nora, the networking specialist, after the handoff from Maya' }] },
  },
};

async function call(method, path, payload) {
  const r = await fetch(API + path, { method, headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 1500)}`);
  return text ? JSON.parse(text) : {};
}

let id = EXISTING;
if (id) {
  await call('PATCH', `/agents/${id}`, body);
  console.log('updated agent', id);
} else {
  const res = await call('POST', '/agents/create', body);
  id = res.agent_id;
  console.log('created agent', id);
  const envPath = new URL('../.env.local', import.meta.url);
  const env = fs.readFileSync(envPath, 'utf8');
  fs.writeFileSync(envPath, /^ELEVENLABS_AGENT_ID=.*$/m.test(env) ? env.replace(/^ELEVENLABS_AGENT_ID=.*$/m, `ELEVENLABS_AGENT_ID=${id}`) : env + `\nELEVENLABS_AGENT_ID=${id}\n`);
  console.log('wrote ELEVENLABS_AGENT_ID to .env.local');
}
const agent = await call('GET', `/agents/${id}`);
const p = agent.conversation_config?.agent?.prompt || {};
console.log('llm:', p.llm, '| tools:', (p.tools || []).map((t) => t.name).join(', ') || `(tool_ids: ${(p.tool_ids || []).length})`, '| voice:', agent.conversation_config?.tts?.voice_id, '| extra voices:', (agent.conversation_config?.tts?.supported_voices || []).map((v) => `${v.label}=${v.voice_id}`).join(', ') || 'none');
