// Automated conversation test: drives the live ElevenLabs agent over WebSocket
// with the demo caller's lines (as text), executes the agent's client tools
// against the real Daytona lab, and checks the expected tool sequence.
// Run: npx tsx --env-file=.env.local scripts/test-agent.ts
import fs from 'node:fs';
import { runProbe, labAction } from '../server/lab.js';
import type { LabAction, ProbeName } from '../server/lab-types.js';

const KEY = process.env.ELEVENLABS_API_KEY!;
const AGENT = process.env.ELEVENLABS_AGENT_ID!;
const lines: { id: string; text: string }[] = JSON.parse(fs.readFileSync('web/public/caller/script.json', 'utf8'));

await labAction('reset'); // boot the lab before the socket opens
const signed = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${AGENT}`, { headers: { 'xi-api-key': KEY } }).then((r) => r.json());
const ws = new WebSocket(signed.signed_url);
const tools: string[] = [];
const lastProbe: Record<string, { ok: boolean; failedBefore: boolean }> = {};
let browserRuns = 0, next = 0, idle: NodeJS.Timeout | undefined, done = false;
let queue: Promise<unknown> = Promise.resolve(); // run tool calls strictly in arrival order, like the web app
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`;
const send = (o: object) => ws.send(JSON.stringify(o));


function scheduleCaller() {
  clearTimeout(idle);
  idle = setTimeout(() => {
    if (done) return;
    const l = lines[next++];
    if (!l) { console.log(ts(), 'no more caller lines; closing'); return finish(); }
    console.log(ts(), `CALLER: ${l.text}`);
    send({ type: 'user_message', text: l.text });
  }, 3500);
}

async function runTool(name: string, p: Record<string, string>): Promise<unknown> {
  switch (name) {
    case 'run_diagnostic': {
      const r = await runProbe(p.probe as ProbeName);
      const issue = r.issue;
      lastProbe[issue] = { ok: r.ok, failedBefore: (lastProbe[issue]?.failedBefore || false) || !r.ok };
      return { label: r.label, ok: r.ok, result: r.result, ran_in: `Daytona sandbox ${r.sandboxId}` };
    }
    case 'customer_action': return labAction(p.action as LabAction);
    case 'update_case_status': {
      if (p.status === 'Resolved · Verified') {
        const lp = p.issue === 'I3' ? { ok: browserRuns >= 2, failedBefore: true } : lastProbe[p.issue];
        if (!lp?.ok || !lp.failedBefore) return { accepted: false, reason: 'No passing test since the last failure' };
      }
      return { accepted: true, status: p.status };
    }
    case 'run_browser_network_test':
      browserRuns++;
      return browserRuns === 1 ? { total: 20, failed: 3, median_ms: 48, jitter_ms: 310, ok: false, note: 'test harness values' } : { total: 20, failed: 0, median_ms: 22, jitter_ms: 18, ok: true, note: 'test harness values' };
    case 'end_case': setTimeout(finish, 1500); return { ok: true };
    default: return { ok: true };
  }
}

function finish() {
  if (done) return; done = true; clearTimeout(idle);
  try { ws.close(); } catch {}
  const has = (n: string) => tools.some((t) => t.startsWith(n));
  const checks: [string, boolean][] = [
    ['ran checkout probe', has('run_diagnostic:http_checkout')],
    ['ran origin bypass', has('run_diagnostic:http_checkout_origin')],
    ['customer purged cache', has('customer_action:purge_checkout_cache')],
    ['ran SPF/DMARC', has('run_diagnostic:spf') && has('run_diagnostic:dmarc')],
    ['sent setup message', has('send_setup_message')],
    ['handed off to Nora', has('handoff_to_nora')],
    ['ran browser test twice', tools.filter((t) => t === 'run_browser_network_test').length >= 2],
  ];
  console.log('\nTOOLS:', tools.join(' → '));
  for (const [n, ok] of checks) console.log(ok ? 'PASS' : 'FAIL', n);
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

ws.onopen = () => send({
  type: 'conversation_initiation_client_data',
  dynamic_variables: {
    issue_text: 'We moved to new office internet this weekend. Since this morning, checkout on our store shows "Bad Gateway" for most customers. Our order-confirmation emails land in spam since we switched to Google Workspace. And my laptop\'s Wi-Fi keeps dropping.',
    site: 'shop.ai7demo.app', domain: 'ai7demo.app', revenue_per_day: '28800', sla: '99.9%',
  },
});
ws.onmessage = async (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.type === 'ping') return send({ type: 'pong', event_id: m.ping_event.event_id });
  if (m.type === 'agent_response') { console.log(ts(), `AGENT: ${m.agent_response_event.agent_response}`); scheduleCaller(); }
  if (m.type === 'client_tool_call') {
    clearTimeout(idle);
    const c = m.client_tool_call; const p = c.parameters || {};
    tools.push(c.tool_name + (p.probe ? ':' + p.probe : p.action ? ':' + p.action : p.status ? ':' + p.issue + '=' + p.status : ''));
    const run = queue.then(() => runTool(c.tool_name, p));
    queue = run.catch(() => undefined);
    const result = await run;
    console.log(ts(), `TOOL ${c.tool_name}(${JSON.stringify(p)}) → ${JSON.stringify(result).slice(0, 160)}`);
    send({ type: 'client_tool_result', tool_call_id: c.tool_call_id, result: JSON.stringify(result), is_error: false });
  }
};
ws.onerror = (e) => console.error('ws error', e);
ws.onclose = () => { if (!done) { console.log(ts(), 'socket closed'); finish(); } };
setTimeout(() => { console.log('timeout'); finish(); }, 240000);
