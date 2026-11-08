// Daytona lab: one long-lived sandbox (auto-stop disabled) that runs a copy of
// the demo customer's stack (lab/lab_server.py). Diagnostic probes are fixed,
// read-only shell commands executed inside that sandbox. The agent only picks a
// probe name; it never supplies a command, host or port.
import fs from 'node:fs';
import path from 'node:path';
import { Daytona, type Sandbox } from '@daytona/sdk';
import { PROBES, type LabAction, type LabActionResult, type ProbeName, type ProbeResult } from './lab-types.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ID_FILE = path.join(ROOT, '.lab-sandbox');
const LAB_FILE = path.join(ROOT, 'lab', 'lab_server.py');
const DIG = 'dig @127.0.0.1 -p 5353 +time=2 +tries=1 +short';
const CURL = "curl -s -o /dev/null -D - -m 5 -w 'CODE=%{http_code} T=%{time_total}'";

const PROBE_CMD: Record<ProbeName, string> = {
  dns_shop: `${DIG} A shop.ai7demo.app; echo ---; ${DIG} A www.ai7demo.app`,
  http_checkout: `${CURL} http://127.0.0.1:8080/checkout`,
  http_checkout_origin: `${CURL} http://127.0.0.1:8081/checkout`,
  mx: `${DIG} MX ai7demo.app`,
  spf: `${DIG} TXT ai7demo.app`,
  dmarc: `${DIG} TXT _dmarc.ai7demo.app`,
};
const ACTION_PATH: Record<LabAction, string> = {
  purge_checkout_cache: '/__lab/purge',
  fix_email_dns: '/__lab/fix-email',
  reset: '/__lab/reset',
};

let daytona: Daytona | null = null;
function client() {
  return (daytona ??= new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
    apiUrl: process.env.DAYTONA_API_URL || 'https://app.daytona.io/api',
    target: process.env.DAYTONA_TARGET || 'us',
  }));
}

async function sh(sb: Sandbox, cmd: string, timeout = 20): Promise<string> {
  const r = await sb.process.executeCommand(cmd, undefined, undefined, timeout);
  return (r.result || '').trim();
}

async function servicesUp(sb: Sandbox) {
  return (await sh(sb, 'curl -s -m 2 http://127.0.0.1:8080/__lab/status', 10).catch(() => '')).includes('"spf"');
}

async function boot(): Promise<Sandbox> {
  const d = client();
  let sb: Sandbox | undefined;
  const saved = process.env.LAB_SANDBOX_ID || (fs.existsSync(ID_FILE) ? fs.readFileSync(ID_FILE, 'utf8').trim() : '');
  if (saved) {
    try {
      sb = await d.get(saved);
      if (String(sb.state) !== 'started') await sb.start(90);
    } catch {
      sb = undefined;
    }
  }
  if (!sb) {
    sb = await d.create({ language: 'python', autoStopInterval: 0, labels: { app: 'ai7-lab' } });
    try { fs.writeFileSync(ID_FILE, sb.id); } catch { /* read-only filesystem in some deploys */ }
  }
  await sb.setAutostopInterval(0).catch(() => {});
  await sb.setAutoPauseInterval(0).catch(() => {});
  if (!(await servicesUp(sb))) {
    await sb.fs.uploadFile(fs.readFileSync(LAB_FILE), 'lab_server.py');
    await sb.process.createSession('lab').catch(() => {});
    await sb.process.executeSessionCommand('lab', { command: 'python3 lab_server.py > lab.log 2>&1', runAsync: true });
    for (let i = 0; i < 20 && !(await servicesUp(sb)); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await servicesUp(sb))) throw new Error('Lab services did not start: ' + (await sh(sb, 'tail -5 lab.log')));
  }
  return sb;
}

let labP: Promise<Sandbox> | null = null;
function lab() {
  return (labP ??= boot().catch((e) => {
    labP = null;
    throw e;
  }));
}

function parseHttp(out: string) {
  const code = Number(/CODE=(\d+)/.exec(out)?.[1] || 0);
  const cache = /x-cache:\s*(\w+)/i.exec(out)?.[1];
  const age = /^age:\s*(\d+)/im.exec(out)?.[1];
  const reason = /^HTTP\/[\d.]+ \d+ ?(.*)$/m.exec(out)?.[1]?.trim();
  const parts = [`${code}${reason ? ' ' + reason : ''}`];
  if (cache) parts.push(`x-cache: ${cache.toUpperCase()}`);
  if (age && Number(age) > 0) parts.push(`age ${age} s`);
  return { ok: code >= 200 && code < 300, result: parts.join(' · ') };
}

function interpret(probe: ProbeName, out: string): { ok: boolean; result: string } {
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  switch (probe) {
    case 'dns_shop': {
      const [a, b] = out.split('---').map((s) => s.trim().split('\n')[0] || '');
      const ok = !!a && a === b;
      return { ok, result: ok ? `shop + www → ${a} (same edge)` : `shop → ${a || 'none'}, www → ${b || 'none'}` };
    }
    case 'http_checkout':
    case 'http_checkout_origin':
      return parseHttp(out);
    case 'mx': {
      lines.sort((x, y) => parseInt(x) - parseInt(y));
      const google = lines.filter((l) => /google\.com\.?$/i.test(l));
      return { ok: google.length > 0, result: lines.length ? `${lines[0]} (+${lines.length - 1} more)` : 'No MX records' };
    }
    case 'spf': {
      const spf = lines.find((l) => l.includes('v=spf1'))?.replace(/"/g, '') || '';
      return { ok: spf.includes('_spf.google.com'), result: spf || 'No SPF record' };
    }
    case 'dmarc': {
      const rec = lines.find((l) => l.includes('v=DMARC1'))?.replace(/"/g, '') || '';
      return { ok: !!rec, result: rec || 'No DMARC record' };
    }
  }
}

export async function runProbe(probe: ProbeName): Promise<ProbeResult> {
  const p = PROBES[probe];
  const base = { probe, issue: p.issue, label: p.label, target: probe.startsWith('http') ? 'shop.ai7demo.app' : 'ai7demo.app' };
  const t = Date.now();
  try {
    const sb = await lab();
    const out = await sh(sb, PROBE_CMD[probe]);
    const { ok, result } = interpret(probe, out);
    return { ...base, ok, result, ms: Date.now() - t, sandboxId: sb.id, raw: out.slice(0, 600) };
  } catch (e) {
    // Never invent a result: report that the probe could not run.
    const msg = e instanceof Error ? e.message : String(e);
    return { ...base, ok: false, result: 'Probe could not run', ms: Date.now() - t, sandboxId: 'unavailable', error: msg.slice(0, 300) };
  }
}

export async function labAction(action: LabAction): Promise<LabActionResult> {
  try {
    const sb = await lab();
    const out = await sh(sb, `curl -s -m 5 http://127.0.0.1:8080${ACTION_PATH[action]}`);
    return { ok: out.length > 0, detail: out || 'no response from lab' };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function labStatus(): Promise<{ ready: boolean; sandboxId?: string; detail: string }> {
  try {
    const sb = await lab();
    return { ready: true, sandboxId: sb.id, detail: await sh(sb, 'curl -s -m 3 http://127.0.0.1:8080/__lab/status') };
  } catch (e) {
    return { ready: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
