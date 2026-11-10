import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConversation } from '@elevenlabs/react';
import { AGENTS, DEFAULT_ISSUE_TEXT, HYP_LABEL, ISSUES, issueById, statusCls, type AgentKey, type IssueId } from './data';
import { installFakeMic, isCallerPlaying, loadCallerScript, playCallerLine, stopCaller, type CallerLine } from './demoCaller';

type Screen = 'intake' | 'review' | 'live' | 'summary';
type Msg = { cls: string; who?: string; text: string };
type NodeState = { s: string; r?: string };
type Test = { issue: IssueId; label: string; result: string; ok: boolean; ms: string; src: string; simulated?: boolean; error?: string };
type Find = [IssueId, string, string, string];
type Event = { t: number; label: string };
type ProbeResult = { probe: string; issue: IssueId; label: string; target: string; ok: boolean; result: string; ms: number; sandboxId: string; raw?: string; simulated?: boolean; error?: string };

const ORDER: Screen[] = ['intake', 'review', 'live', 'summary'];
const STEP_LABELS = ['1 · Describe', '2 · Triage', '3 · Live support', '4 · Summary'];
const VERIFIED = 'Resolved · Verified';

const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !(data && typeof data === 'object' && ('blocked' in data || 'accepted' in data))) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function App() {
  // ---------- form ----------
  const [screen, setScreen] = useState<Screen>('intake');
  const [issueText, setIssueText] = useState(DEFAULT_ISSUE_TEXT);
  const [siteIn, setSiteIn] = useState('shop.ai7demo.app');
  const [rev, setRev] = useState(28800);
  const [sla, setSla] = useState(99.9);
  const [consent, setConsent] = useState(false);
  const [demoCaller, setDemoCaller] = useState(false);
  const [labMsg, setLabMsg] = useState('');

  const site = useMemo(() => (siteIn.trim() || 'shop.ai7demo.app').replace(/^https?:\/\//, '').replace(/\/.*$/, ''), [siteIn]);
  const domain = useMemo(() => { const p = site.split('.'); return p.length > 2 ? p.slice(1).join('.') : site; }, [site]);
  const perMin = rev / 1440;
  const slaMonthMin = sla ? (30 * 1440 * (100 - sla)) / 100 : 0;

  // ---------- live case state ----------
  const [caseId, setCaseId] = useState('');
  const [agent, setAgent] = useState<AgentKey>('maya');
  const [pill, setPill] = useState<{ kind: string; text: string }>({ kind: '', text: 'Connecting' });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [cur, setCur] = useState<IssueId>('I1');
  const [istat, setIstat] = useState<Record<IssueId, string>>({ I1: 'Queued', I2: 'Queued', I3: 'Queued' });
  const [pb, setPb] = useState<Record<string, NodeState>>({});
  const [hyp, setHyp] = useState<Record<string, NodeState>>({});
  const [finds, setFinds] = useState<Find[]>([]);
  const [tests, setTests] = useState<Test[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [fixShown, setFixShown] = useState(false);
  const [t0, setT0] = useState(0);
  const [tEnd, setTEnd] = useState(0);
  const [firstFail, setFirstFail] = useState(0);
  const [resolvedAt, setResolvedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [textIn, setTextIn] = useState('');
  const [toast, setToast] = useState('');
  const [callerLines, setCallerLines] = useState<CallerLine[]>([]);
  const [callerIdx, setCallerIdx] = useState(0);
  const [callerPaused, setCallerPaused] = useState(false);

  // refs for tool handlers (registered once)
  const R = useRef({ caseId: '', cur: 'I1' as IssueId, agent: 'maya' as AgentKey, t0: 0, pb: {} as Record<string, NodeState>, domain, toolsRunning: 0, firstFail: 0 });
  R.current.caseId = caseId; R.current.cur = cur; R.current.agent = agent; R.current.t0 = t0; R.current.pb = pb; R.current.domain = domain; R.current.firstFail = firstFail;
  const msgsRef = useRef<HTMLUListElement>(null);

  const addMsg = useCallback((m: Msg) => setMsgs((x) => [...x, m]), []);
  const log = useCallback((label: string) => setEvents((x) => [...x, { t: Date.now() - (R.current.t0 || Date.now()), label }]), []);
  const setNode = useCallback((issue: IssueId, id: string, s: string, r?: string) => setPb((x) => ({ ...x, [issue + id]: { s, r } })), []);
  const setH = useCallback((issue: IssueId, id: string, s: string, r?: string) => setHyp((x) => ({ ...x, [issue + id]: { s, r } })), []);
  const addFind = useCallback((f: Find) => setFinds((x) => [...x, f]), []);

  useEffect(() => { msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight }); }, [msgs]);
  useEffect(() => {
    if (screen !== 'live') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [screen]);

  // ---------- tool implementations ----------
  const withTool = async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
    R.current.toolsRunning++;
    setPill({ kind: 'testing', text: label });
    try { return await fn(); } finally { R.current.toolsRunning--; }
  };

  const applyProbe = (r: ProbeResult) => {
    const issue = r.issue;
    const p = R.current.pb;
    const failed = (id: string) => p[issue + id]?.s === 'fail';
    const evidence = `${r.label}: ${r.result}`;
    if (r.error) {
      addFind([issue, 'hyp', 'Not run', `${r.label} could not run (${r.error.slice(0, 80)}). No result was assumed.`]);
      return;
    }
    let node = '';
    if (issue === 'I1') {
      if (r.probe === 'dns_shop') { node = 'T1'; setH(issue, 'H1', r.ok ? 'out' : 'likely', r.ok ? 'Both names resolve to the same edge server.' : 'shop and www resolve differently.'); }
      if (r.probe === 'http_checkout') {
        node = failed('T2') || p[issue + 'A1'] ? 'V1' : 'T2';
        if (!r.ok) {
          setH(issue, 'H3', /HIT/i.test(r.result) ? 'likely' : 'open', /HIT/i.test(r.result) ? 'The error is served from the CDN cache.' : undefined);
          if (!R.current.firstFail) setFirstFail(Date.now());
        } else if (node === 'V1') setH(issue, 'H3', 'conf', 'Purging the cache fixed checkout. Confirmed by re-test.');
      }
      if (r.probe === 'http_checkout_origin') { node = 'T3'; setH(issue, 'H2', r.ok ? 'out' : 'likely', r.ok ? 'The server returns checkout correctly when the cache is bypassed.' : 'The origin server itself fails.'); }
    }
    if (issue === 'I2') {
      if (r.probe === 'mx') { node = 'T1'; setH(issue, 'H1', r.ok ? 'out' : 'likely', r.ok ? 'MX already points to Google Workspace.' : 'MX does not point to Google.'); }
      if (r.probe === 'spf') {
        node = failed('T2') ? 'V1' : 'T2';
        setH(issue, 'H2', r.ok ? (node === 'V1' ? 'conf' : 'out') : 'likely', r.ok ? (node === 'V1' ? 'SPF now authorizes Google. Confirmed by re-check.' : 'SPF includes Google.') : 'SPF does not include _spf.google.com.');
      }
      if (r.probe === 'dmarc') {
        node = failed('T3') ? 'V1' : 'T3';
        setH(issue, 'H3', r.ok ? (node === 'V1' ? 'conf' : 'out') : 'likely', r.ok ? 'A DMARC record is published.' : 'No DMARC record is published.');
      }
    }
    if (node) setNode(issue, node, r.ok ? 'pass' : 'fail', r.result);
    addFind([issue, 'obs', 'Observed', evidence]);
  };

  const tools = useRef({
    set_current_issue: async ({ issue }: { issue?: string }) => {
      const id = (['I1', 'I2', 'I3'].includes(String(issue)) ? issue : 'I1') as IssueId;
      setCur(id);
      setIstat((x) => (x[id] === 'Queued' ? { ...x, [id]: 'Diagnosing' } : x));
      addMsg({ cls: 'sys issue', text: `Now working on issue ${id.slice(1)}: ${issueById(id).title}` });
      log(`Started issue ${id.slice(1)}: ${issueById(id).title}`);
      return JSON.stringify({ ok: true, current_issue: id, title: issueById(id).title });
    },
    run_diagnostic: async ({ probe }: { probe?: string }) =>
      withTool(`Running ${probe ?? 'test'}`, async () => {
        const r = await api<ProbeResult & { blocked?: boolean; reason?: string }>('/api/diagnose', { caseId: R.current.caseId, probe });
        if (r.blocked) {
          addMsg({ cls: 'sys block', text: `Blocked by policy · ${r.reason}` });
          log(`Guardrail: blocked diagnostic "${probe}"`);
          return JSON.stringify({ blocked: true, reason: r.reason });
        }
        const src = r.error ? 'not run' : `Daytona ${r.sandboxId.slice(0, 8)}`;
        setTests((x) => [...x, { issue: r.issue, label: r.label, result: r.result, ok: r.ok, ms: `${r.ms} ms`, src, simulated: r.simulated, error: r.error }]);
        addMsg({ cls: r.error ? 'sys block' : 'sys test', text: `${r.label} → ${r.result} · ${r.ms} ms · ${r.error ? 'could not run: ' + r.error.slice(0, 120) : 'ran in Daytona sandbox ' + r.sandboxId.slice(0, 8)}${r.simulated ? ' · SIMULATED' : ''}` });
        log(`${r.label}: ${r.result}`);
        applyProbe(r);
        return JSON.stringify({ probe: r.probe, ok: r.ok, result: r.result, ran_in: r.error ? null : 'Daytona sandbox', error: r.error ?? null, simulated: !!r.simulated });
      }),
    update_case_status: async ({ issue, status }: { issue?: string; status?: string }) => {
      const id = (issue || R.current.cur) as IssueId;
      const r = await api<{ accepted: boolean; reason?: string; status?: string }>('/api/case/status', { caseId: R.current.caseId, issue: id, status });
      if (!r.accepted) {
        addMsg({ cls: 'sys reject', text: `Rejected · update_case_status(${id} → "${status}"): ${r.reason}` });
        log(`Status change rejected for issue ${id.slice(1)}: ${r.reason}`);
        return JSON.stringify({ accepted: false, reason: r.reason });
      }
      setIstat((x) => ({ ...x, [id]: String(status) }));
      log(`Issue ${id.slice(1)} → ${status}`);
      if (status === VERIFIED && id === 'I1') setResolvedAt(Date.now());
      if (status === 'Waiting for DNS') setNode('I2', 'V1', 'wait', 'Re-check after DNS updates');
      return JSON.stringify({ accepted: true, status });
    },
    send_setup_message: async ({ domain: d }: { domain?: string }) => {
      setFixShown(true);
      setNode('I2', 'A1', 'done', 'Setup message ready');
      addMsg({ cls: 'sys action', text: `Setup message ready for ${d || R.current.domain}: SPF fix, DMARC record, DKIM steps. Shown on screen to copy.` });
      log('Setup message prepared (SPF, DMARC, DKIM)');
      return JSON.stringify({ ok: true, delivered: 'shown on screen for the customer to copy', records: { spf: 'v=spf1 include:_spf.google.com ~all', dmarc: `v=DMARC1; p=none; rua=mailto:dmarc@${d || R.current.domain}` } });
    },
    customer_action: async ({ action }: { action?: string }) =>
      withTool('Customer action', async () => {
        const r = await api<{ ok: boolean; detail: string }>('/api/lab/action', { action });
        const what = action === 'purge_checkout_cache' ? 'purged /checkout from the CDN cache' : action === 'fix_email_dns' ? 'added the SPF and DMARC records' : String(action);
        addMsg({ cls: 'sys action', text: `Customer action: ${what}${r.ok ? '' : ' (lab did not confirm: ' + r.detail.slice(0, 80) + ')'}` });
        log(`Customer action: ${what}`);
        if (action === 'purge_checkout_cache') { setNode('I1', 'A1', 'done', 'Customer purged /checkout'); addFind(['I1', 'cust', 'Customer did', 'Purged /checkout from the CDN cache.']); }
        if (action === 'fix_email_dns') addFind(['I2', 'cust', 'Customer did', 'Added the SPF and DMARC records from the setup message.']);
        return JSON.stringify({ ok: r.ok, detail: r.detail });
      }),
    run_browser_network_test: async () =>
      withTool('Testing from your browser', async () => {
        const times: number[] = [];
        let failed = 0;
        const total = 20;
        const start = performance.now();
        for (let i = 0; i < total; i++) {
          const t = performance.now();
          try {
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), 2000);
            const res = await fetch(`/api/ping?ts=${Date.now()}-${i}`, { cache: 'no-store', signal: ctl.signal });
            clearTimeout(timer);
            if (res.status !== 204) failed++; else times.push(performance.now() - t);
          } catch { failed++; }
        }
        const sorted = [...times].sort((a, b) => a - b);
        const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
        const mean = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
        const jitter = times.length > 1 ? times.slice(1).reduce((a, v, i) => a + Math.abs(v - times[i]), 0) / (times.length - 1) : 0;
        const ok = failed === 0 && jitter < 50;
        const stats = { median_ms: Math.round(median), jitter_ms: Math.round(jitter), mean_ms: Math.round(mean), failed, total };
        await api('/api/case/browser-test', { caseId: R.current.caseId, ok, stats }).catch(() => {});
        const result = `${total} requests · median ${stats.median_ms} ms · jitter ${stats.jitter_ms} ms · ${failed} failed`;
        const p = R.current.pb;
        const node = p['I3T1']?.s === 'fail' ? 'V1' : 'T1';
        if (node === 'V1') { setNode('I3', 'Q1', 'done', 'Answered'); setNode('I3', 'A1', 'done', 'Customer changed network'); }
        setNode('I3', node, ok ? 'pass' : 'fail', result);
        if (!ok) { setH('I3', 'H3', 'likely', 'Failures or jitter on this one device point to the Wi-Fi link.'); if (median < 300) setH('I3', 'H2', 'out', 'Most requests got through quickly, so the provider is up.'); }
        else if (node === 'V1') setH('I3', 'H3', 'conf', 'After the network change, the connection is stable.');
        setTests((x) => [...x, { issue: 'I3', label: 'Browser network test', result, ok, ms: `${((performance.now() - start) / 1000).toFixed(1)} s`, src: 'Your browser' }]);
        addFind(['I3', 'obs', 'Observed', `From this device: ${result}.`]);
        addMsg({ cls: 'sys test', text: `Browser network test → ${result} · ran in your browser` });
        log(`Browser network test: ${result}`);
        return JSON.stringify({ ok, ...stats, note: 'Measured from the customer browser to the AI7 server.' });
      }),
    handoff_to_nora: async ({ summary }: { summary?: string }) => {
      setAgent('nora');
      setH('I3', 'H1', 'out', 'Checks from the internet show the website and DNS are healthy.');
      addMsg({ cls: 'sys hand', text: `Handoff: Maya → Nora · context transferred${summary ? ': ' + summary.slice(0, 160) : ''}` });
      log('Handoff Maya → Nora with full context');
      return JSON.stringify({ ok: true, now_speaking: 'Nora, Networking Specialist' });
    },
    end_case: async () => {
      setTimeout(() => endCall(), 2500);
      return JSON.stringify({ ok: true });
    },
  });

  // The agent may fire several tool calls at once (e.g. "customer purged" + "re-test").
  // Run them strictly in the order they arrive so a re-test never races the fix.
  const toolQueue = useRef<Promise<unknown>>(Promise.resolve());
  const clientTools = useMemo(() => {
    const t = tools.current;
    const exec = async (name: keyof typeof t, params: Record<string, unknown>) => {
      try { return await (t[name] as (p: Record<string, unknown>) => Promise<string>)(params ?? {}); }
      catch (e) { const m = e instanceof Error ? e.message : String(e); addMsg({ cls: 'sys block', text: `${name} failed: ${m}` }); return JSON.stringify({ ok: false, error: m }); }
    };
    const wrap = (name: keyof typeof t) => (params: Record<string, unknown>) => {
      const run = toolQueue.current.then(() => exec(name, params));
      toolQueue.current = run.catch(() => undefined);
      return run;
    };
    return Object.fromEntries((Object.keys(t) as (keyof typeof t)[]).map((k) => [k, wrap(k)]));
  }, [addMsg]);

  // ---------- conversation ----------
  const lastMode = useRef<'speaking' | 'listening' | ''>('');
  const callerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callerState = useRef({ on: false, paused: false, idx: 0, lines: [] as CallerLine[] });
  callerState.current.on = demoCaller; callerState.current.paused = callerPaused; callerState.current.idx = callerIdx; callerState.current.lines = callerLines;

  // 'voice': caller clips go into a fake microphone. 'text': clips play to the
  // speakers and the same words are sent to the agent as a text turn.
  const CALLER_INPUT: 'voice' | 'text' = (new URLSearchParams(location.search).get('caller') === 'voice') ? 'voice' : 'text';
  const playNextCaller = useCallback(async () => {
    const cs = callerState.current;
    if (isCallerPlaying() || cs.idx >= cs.lines.length) return;
    const line = cs.lines[cs.idx];
    setCallerIdx(cs.idx + 1);
    callerState.current.idx = cs.idx + 1;
    const ok = await playCallerLine(line, CALLER_INPUT === 'voice');
    if (ok && CALLER_INPUT === 'text') {
      addMsg({ cls: 'cust', who: 'You', text: line.text });
      convRef.current?.sendUserMessage(line.text);
    }
    if (!ok) addMsg({ cls: 'sys reject', text: `Demo caller clip "${line.file}" could not play.` });
  }, [addMsg]);

  const convRef = useRef<{ sendUserMessage: (t: string) => void } | null>(null);
  const conversation = useConversation({
    clientTools,
    onMessage: ({ message: raw, role }) => {
      const message = raw?.replace(/<\/?Nora>/g, '').trim(); // multi-voice tags from the agent
      if (!message) return;
      if (role === 'user') addMsg({ cls: 'cust', who: 'You', text: message });
      else { const a = AGENTS[R.current.agent]; addMsg({ cls: 'agent-m ' + a.cls, who: a.name, text: message }); }
    },
    onModeChange: ({ mode }) => {
      if (R.current.toolsRunning === 0) setPill(mode === 'speaking' ? { kind: 'speaking', text: 'Speaking' } : { kind: 'listening', text: 'Listening' });
      const prev = lastMode.current;
      lastMode.current = mode;
      if (callerTimer.current) { clearTimeout(callerTimer.current); callerTimer.current = null; }
      if (mode === 'listening' && prev === 'speaking' && callerState.current.on && !callerState.current.paused) {
        callerTimer.current = setTimeout(() => {
          if (lastMode.current === 'listening' && R.current.toolsRunning === 0) void playNextCaller();
        }, 1800);
      }
    },
    onError: (message) => { setError(typeof message === 'string' ? message : 'Voice connection error'); },
    onDisconnect: () => { setPill({ kind: '', text: 'Call ended' }); },
  });
  convRef.current = conversation;

  const startLive = async () => {
    setError('');
    setMsgs([{ cls: 'empty', text: 'Maya is joining the call…' }]);
    setAgent('maya'); setCur('I1'); setIstat({ I1: 'Queued', I2: 'Queued', I3: 'Queued' });
    setPb({}); setHyp({}); setFinds([]); setTests([]); setEvents([]); setFixShown(false);
    setFirstFail(0); setResolvedAt(0); setTEnd(0); setCallerIdx(0); setCallerPaused(false);
    lastMode.current = '';
    const start = Date.now();
    setT0(start); R.current.t0 = start; R.current.firstFail = 0;
    setPill({ kind: '', text: 'Connecting' });
    setScreen('live');
    try {
      const { caseId: id } = await api<{ caseId: string }>('/api/case', {});
      setCaseId(id); R.current.caseId = id;
      log(`Case ${id} opened`);
      if (demoCaller) {
        await installFakeMic();
        const lines = await loadCallerScript();
        setCallerLines(lines); callerState.current.lines = lines;
        if (!lines.length) addMsg({ cls: 'sys reject', text: 'Demo caller is on, but no caller clips were found in /caller/script.json.' });
      } else {
        await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()));
      }
      const { signedUrl } = await api<{ signedUrl: string }>('/api/signed-url');
      conversation.startSession({
        signedUrl,
        dynamicVariables: { issue_text: issueText, site, domain, revenue_per_day: rev, sla: sla ? `${sla}%` : 'none', case_id: id },
      });
      log('Voice session started with Maya');
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/Permission|NotAllowed/i.test(m) ? 'Microphone access was blocked. Allow the microphone in your browser, then retry.' : m);
      setPill({ kind: '', text: 'Not connected' });
    }
  };

  const endCall = () => {
    stopCaller();
    if (callerTimer.current) clearTimeout(callerTimer.current);
    try { conversation.endSession(); } catch { /* already closed */ }
    setTEnd(Date.now());
    setIstat((x) => {
      const y = { ...x };
      (Object.keys(y) as IssueId[]).forEach((k) => { if (['Queued', 'Diagnosing', 'Verifying', 'Waiting for customer'].includes(y[k])) y[k] = 'Escalation required'; });
      return y;
    });
    log('Call ended');
    setScreen('summary');
  };
  useEffect(() => { (tools.current as Record<string, unknown>).end_case = async () => { setTimeout(() => endCallRef.current(), 2500); return JSON.stringify({ ok: true }); }; }, []);
  const endCallRef = useRef(endCall);
  endCallRef.current = endCall;

  const sendText = () => {
    const t = textIn.trim();
    if (!t) return;
    conversation.sendUserMessage(t);
    setTextIn('');
  };

  const resetLab = async () => {
    setLabMsg('Resetting the lab…');
    try { const r = await api<{ ok: boolean; detail: string }>('/api/lab/action', { action: 'reset' }); setLabMsg(r.ok ? 'Lab reset to the broken starting state.' : 'Lab reset failed: ' + r.detail.slice(0, 120)); }
    catch (e) { setLabMsg('Lab reset failed: ' + (e instanceof Error ? e.message : String(e))); }
  };

  // ---------- derived ----------
  const overall = (): [string, string] => {
    const v = Object.values(istat);
    if (v.every((s) => s.startsWith('Resolved'))) return [VERIFIED, 'ok'];
    const done = v.filter((s) => s.startsWith('Resolved')).length;
    const wait = v.filter((s) => s.startsWith('Waiting for DNS')).length;
    if (screen === 'summary') return done ? [`${done} of 3 verified${wait ? ` · ${wait} pending` : ''}`, wait ? 'high' : 'crit'] : ['Escalation required', 'crit'];
    return [done ? `${done} of 3 verified` : 'In progress', 'info'];
  };
  const [ov, ovc] = overall();
  const elapsed = (tEnd || now) - t0;
  const riskMs = (resolvedAt || tEnd || now) - t0;
  const risk = rev && t0 ? (perMin * riskMs) / 60000 : 0;
  const down = firstFail && resolvedAt ? resolvedAt - firstFail : 0;
  const curIssue = issueById(cur);
  const a = AGENTS[agent];

  const fixCard = (
    <div className="fix">
      <b>Setup message · {domain}</b>
      <span className="lbl">1. Replace your SPF record (TXT at @)</span><code>v=spf1 include:_spf.google.com ~all</code>
      <span className="lbl">2. Add a DMARC record (TXT at _dmarc)</span><code>v=DMARC1; p=none; rua=mailto:dmarc@{domain}</code>
      <span className="lbl">3. Google Admin → Apps → Gmail → Authenticate email → Start authentication (DKIM)</span>
      <span className="small">Ready to send · copy it to your DNS provider or IT contact</span>
    </div>
  );

  const plain = () => {
    const lines = [`AI7 Tech Support · Case ${caseId} · ${ov}`, `Website: ${site} · Email domain: ${domain}`, ''];
    ISSUES.forEach((x, i) => {
      const st = istat[x.id];
      lines.push(`${i + 1}. ${x.title} [${x.prio[0]}] → ${st}`);
      finds.filter((r) => r[0] === x.id).forEach(([, , l, t]) => lines.push(`   - [${l}] ${t}`));
      lines.push(`   Next: ${st.startsWith('Resolved') ? x.next.done : x.next.open}`, '');
    });
    lines.push('Tests:', ...tests.map((t) => `- Issue ${t.issue.slice(1)} · ${t.label}: ${t.result} (${t.src})`));
    return lines.join('\n');
  };
  const copySummary = async () => {
    try { await navigator.clipboard.writeText(plain()); setToast('Copied to clipboard'); }
    catch { setToast('Copy failed. Select the text and press Cmd+C or Ctrl+C.'); }
  };

  const idx = ORDER.indexOf(screen);
  return (
    <>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <linearGradient id="gm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4f8dff" /><stop offset="1" stopColor="#1d4ed8" /></linearGradient>
          <linearGradient id="gn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2dd4bf" /><stop offset="1" stopColor="#0f766e" /></linearGradient>
          <symbol id="maya" viewBox="0 0 132 132"><circle cx="66" cy="66" r="66" fill="url(#gm)" /><path d="M28 70c0-30 16-46 38-46s38 16 38 46v34H28z" fill="#2a1c19" /><path d="M40 132c4-20 14-28 26-28s22 8 26 28z" fill="#e8eefc" /><ellipse cx="66" cy="68" rx="25" ry="28" fill="#f6cba8" /><path d="M41 62c4-18 14-26 25-26s22 6 26 22c-10-8-22-10-30-10s-15 6-21 14z" fill="#2a1c19" /><ellipse cx="57" cy="70" rx="3.6" ry="4.4" fill="#1d1d2b" /><ellipse cx="75" cy="70" rx="3.6" ry="4.4" fill="#1d1d2b" /><circle cx="58.2" cy="68.6" r="1.2" fill="#fff" /><circle cx="76.2" cy="68.6" r="1.2" fill="#fff" /><circle cx="51" cy="79" r="4" fill="#f59ca0" opacity=".6" /><circle cx="81" cy="79" r="4" fill="#f59ca0" opacity=".6" /><path d="M59 83q7 6 14 0" stroke="#7a2e2e" strokeWidth="2.6" fill="none" strokeLinecap="round" /><path d="M34 66a32 32 0 0 1 64 0" stroke="#3b82f6" strokeWidth="6" fill="none" /><rect x="27" y="62" width="12" height="20" rx="6" fill="#3b82f6" /><rect x="93" y="62" width="12" height="20" rx="6" fill="#3b82f6" /><path d="M99 80q0 16-20 18" stroke="#3b82f6" strokeWidth="3.5" fill="none" /><circle cx="78" cy="98" r="4" fill="#3b82f6" /></symbol>
          <symbol id="nora" viewBox="0 0 132 132"><circle cx="66" cy="66" r="66" fill="url(#gn)" /><path d="M28 72c0-32 16-48 38-48s38 16 38 48v28H28z" fill="#151515" /><path d="M40 132c4-20 14-28 26-28s22 8 26 28z" fill="#e8fbf7" /><ellipse cx="66" cy="68" rx="25" ry="28" fill="#e7b48e" /><path d="M41 60c6-16 14-24 25-24s19 8 25 24c-8-6-14-9-25-9s-17 3-25 9z" fill="#151515" /><ellipse cx="57" cy="70" rx="3.6" ry="4.4" fill="#1d1d2b" /><ellipse cx="75" cy="70" rx="3.6" ry="4.4" fill="#1d1d2b" /><circle cx="58.2" cy="68.6" r="1.2" fill="#fff" /><circle cx="76.2" cy="68.6" r="1.2" fill="#fff" /><circle cx="51" cy="79" r="4" fill="#f59ca0" opacity=".5" /><circle cx="81" cy="79" r="4" fill="#f59ca0" opacity=".5" /><path d="M59 83q7 6 14 0" stroke="#6b2a2a" strokeWidth="2.6" fill="none" strokeLinecap="round" /><path d="M34 66a32 32 0 0 1 64 0" stroke="#2dd4bf" strokeWidth="6" fill="none" /><rect x="27" y="62" width="12" height="20" rx="6" fill="#2dd4bf" /><rect x="93" y="62" width="12" height="20" rx="6" fill="#2dd4bf" /></symbol>
        </defs>
      </svg>
      <header className="appbar"><div className="in">
        <div className="logo"><svg className="logo-ic" viewBox="0 0 34 34" fill="none" stroke="#5aa2ff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 4v8a7 7 0 0 0 14 0V4" /><path d="M14 19v4a6 6 0 0 0 12 0v-3" /><circle cx="26" cy="17" r="3" /></svg><b>Website Doctor</b><span>by AI7 Tech Support</span></div>
        <ol className="steps">{STEP_LABELS.map((l, i) => <li key={l} className={i === idx ? 'on' : i < idx ? 'done' : ''}>{l}</li>)}</ol>
      </div></header>

      <main className="in">
        {screen === 'intake' && (
          <section className="intake">
            <div>
              <h1>Tech problems? Talk to an <span className="hl">AI specialist</span> now.</h1>
              <p className="lead">Describe everything that's wrong, in your own words. We sort it by business impact and connect you with the right specialist.</p>
              <div className="cats" aria-label="Specialists">
                <div className="cat"><svg className="av face"><use href="#maya" /></svg><div><b>Maya · Websites, domains, email</b><span className="s">Available now</span></div><span className="chip ok">Live</span></div>
                <div className="cat"><svg className="av face"><use href="#nora" /></svg><div><b>Nora · Wi-Fi and networks</b><span className="s">Available now</span></div><span className="chip ok">Live</span></div>
                <div className="cat soon"><span className="av">X</span><div><b>Max · Mac and Windows computers</b><span className="s">Coming soon</span></div></div>
              </div>
            </div>
            <form className="card" onSubmit={(e) => { e.preventDefault(); setConsent(false); setScreen('review'); }}>
              <label className="f" htmlFor="issue">What's going wrong?
                <textarea id="issue" value={issueText} onChange={(e) => setIssueText(e.target.value)} />
              </label>
              <label className="f" htmlFor="site">Website address
                <input type="text" id="site" value={siteIn} onChange={(e) => setSiteIn(e.target.value)} autoComplete="off" />
              </label>
              <div className="two">
                <label className="f" htmlFor="rev">Revenue per day <small>Optional. Sets priority.</small>
                  <span className="money"><input type="number" id="rev" value={rev} min={0} step={100} onChange={(e) => setRev(Math.max(0, Number(e.target.value) || 0))} /></span>
                </label>
                <label className="f" htmlFor="sla">Uptime commitment (SLA) <small>Optional</small>
                  <select id="sla" value={sla} onChange={(e) => setSla(Number(e.target.value))}>
                    <option value={0}>None</option><option value={99.5}>99.5%</option><option value={99.9}>99.9%</option><option value={99.99}>99.99%</option>
                  </select>
                </label>
              </div>
              <button className="btn" type="submit">Start Support</button>
              <p className="disclose">AI7 Tech Support is an independent service. It is not affiliated with Apple, Microsoft, Google or your hosting provider.</p>
              <div className="row-btns"><button className="btn ghost sm" type="button" onClick={resetLab}>Reset lab</button><span className="small">{labMsg}</span></div>
            </form>
          </section>
        )}

        {screen === 'review' && (
          <section className="review"><div className="card">
            <div><h2>We found 3 issues. Here's the order we'll fix them in.</h2><p className="small" style={{ marginTop: 6 }}>Sorted by business impact. Anything losing money right now goes first.</p></div>
            <ol className="triage">{ISSUES.map((x, i) => (
              <li key={x.id}><span className="n">{i + 1}</span><span className="t"><b>{x.title}</b><span>{x.why} · {x.owner}</span></span><span className={'chip ' + x.prio[1]}>{x.prio[0]}</span></li>
            ))}</ol>
            <dl className="kv">
              <dt>Website</dt><dd>{site}</dd>
              <dt>Email domain</dt><dd>{domain}</dd>
              <dt>Checkout revenue at risk</dt><dd>{rev ? `${money(perMin)} per minute (from ${money(rev)} per day)` : 'Not provided'}</dd>
              <dt>SLA downtime budget</dt><dd>{sla ? `${slaMonthMin.toFixed(1)} minutes per month at ${sla}%` : 'No SLA'}</dd>
            </dl>
            <label className="consent" htmlFor="consent"><input type="checkbox" id="consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>I agree this voice session is transcribed and saved to my case. California law requires everyone's consent before a call is recorded.</span></label>
            <label className="toggle" htmlFor="democaller"><input type="checkbox" id="democaller" checked={demoCaller} onChange={(e) => setDemoCaller(e.target.checked)} /><span><b>Demo caller</b> · play the pre-recorded caller lines (synthesized with a stock ElevenLabs voice) instead of using the microphone. Maya's and Nora's replies stay live.</span></label>
            <div className="row-btns"><button className="btn ghost" type="button" onClick={() => setScreen('intake')}>Edit details</button><button className="btn" type="button" disabled={!consent} onClick={startLive}>Start voice session</button></div>
          </div></section>
        )}

        {screen === 'live' && (
          <section className="live">
            <div className={`card agent ${pill.kind}`}>
              <svg className={`av big-av face ${a.cls}`}><use href={a.cls === 'nora' ? '#nora' : '#maya'} /></svg>
              <div><h2>{a.name}</h2><p className="role">{a.role}</p></div>
              <span className={`pill ${pill.kind}`}>{pill.text}</span>
              <div className="wave" aria-hidden="true"><i /><i /><i /><i /><i /></div>
              <span className="timer">Session {clock(elapsed)}</span>
              <div className="ctrl">
                <button className="btn ghost" type="button" onClick={() => conversation.setMuted(!conversation.isMuted)}>{conversation.isMuted ? 'Unmute' : 'Mute'}</button>
                <button className="btn danger" type="button" onClick={endCall}>End call</button>
              </div>
              {demoCaller && (
                <div className="caller">
                  <span className="small">Demo caller · line {Math.min(callerIdx, callerLines.length)} of {callerLines.length}</span>
                  <div className="ctrl">
                    <button className="btn sm" type="button" onClick={() => void playNextCaller()} disabled={callerIdx >= callerLines.length}>Next caller line</button>
                    <button className="btn ghost sm" type="button" onClick={() => setCallerPaused((p) => !p)}>{callerPaused ? 'Resume caller' : 'Pause caller'}</button>
                  </div>
                  {callerLines[callerIdx] && <span className="small">Next: “{callerLines[callerIdx].text.slice(0, 80)}”</span>}
                </div>
              )}
            </div>
            <div className="card convo">
              <header><h3>Conversation</h3><span className="small">Live transcript · case {caseId || '…'}</span></header>
              {error && <div className="err" style={{ margin: '12px 18px 0' }}><span>{error}</span><button className="btn sm" type="button" onClick={startLive}>Retry</button></div>}
              <ul className="msgs" ref={msgsRef}>
                {msgs.map((m, i) => m.cls === 'empty'
                  ? <li key={i} className="empty">{m.text}</li>
                  : <li key={i} className={m.cls}>{m.who && <span className="who">{m.who}</span>}<span className="txt">{m.text}</span></li>)}
              </ul>
              <form className="textin" onSubmit={(e) => { e.preventDefault(); sendText(); }}>
                <input type="text" id="textin" placeholder="Voice not working? Type a message" value={textIn} onChange={(e) => setTextIn(e.target.value)} />
                <button className="btn sm" type="submit" disabled={conversation.status !== 'connected'}>Send</button>
              </form>
            </div>
            <div className="card casep">
              <div>
                <div className="ch"><b>Case {caseId || '…'}</b><span className={'chip ' + ovc}>{ov}</span></div>
                <ul className="issues">{ISSUES.map((x, i) => (
                  <li key={x.id} className={x.id === cur ? 'cur' : ''}><span className="n">{i + 1}</span><span>{x.title} <span className={'chip ' + x.prio[1]}>{x.prio[0]}</span></span><span className={'chip ' + statusCls(istat[x.id])}>{istat[x.id]}</span></li>
                ))}</ul>
              </div>
              <div><h3>Checkout revenue at risk</h3><span className={'risk' + (resolvedAt ? ' stopped' : '')}>{money(risk)}</span><span className="small">{rev ? 'Estimated from your daily revenue. Stops when checkout is verified.' : 'Add daily revenue at intake to see this estimate.'}</span></div>
              {fixShown && <div><h3>Setup message</h3>{fixCard}</div>}
              <div><h3>Hypotheses · issue {cur.slice(1)}</h3><ul className="hyp">{curIssue.hyps.map(([id, text]) => {
                const st = hyp[cur + id] || { s: 'open' };
                const [lbl, cls] = HYP_LABEL[st.s];
                return <li key={id} className={st.s}><span className="h">{text}</span><span className={'chip ' + cls}>{lbl}</span>{st.r && <span className="why">{st.r}</span>}</li>;
              })}</ul></div>
              <div><h3>Playbook · {curIssue.title}</h3><ol className="pb">{curIssue.pb.map(([id, kind, text, rule]) => {
                const st = pb[cur + id] || { s: 'pending' };
                return <li key={id} className={st.s}><span className="dot" /><span className="nt"><em>{id} · {kind}</em>{text}</span>{rule && <span className="meta">{rule}</span>}{st.r && <span className="res">→ {st.r}</span>}</li>;
              })}</ol></div>
              <div><h3>Evidence</h3><ul className="ev">{tests.length ? [...tests].reverse().map((t, i) => (
                <li key={i}><span className="r1"><b>{t.label}</b><span className={t.ok ? 'okk' : 'bad'}>{t.error ? 'NOT RUN' : t.ok ? 'PASS' : 'FAIL'}</span></span><span>{t.result}</span><span className="src">Issue {t.issue.slice(1)} · {t.ms} · {t.src} {t.simulated && <span className="chip sim">SIMULATED</span>}</span></li>
              )) : <li className="src" style={{ background: 'none', padding: 0 }}>No tests run yet.</li>}</ul></div>
            </div>
          </section>
        )}

        {screen === 'summary' && (
          <section>
            <div className="sumhead">
              <div><span className="small">Case {caseId} · Maya{agent === 'nora' ? ' and Nora' : ''}</span><h1>Case summary</h1></div>
              <span className={'chip ' + ovc}>{ov}</span>
            </div>
            <div className="sum">
              <div className="card">
                <dl className="kv">
                  <dt>Reported</dt><dd>{issueText}</dd>
                  <dt>Website</dt><dd>{site}</dd>
                  <dt>Email domain</dt><dd>{domain}</dd>
                </dl>
                {ISSUES.map((x, i) => {
                  const st = istat[x.id];
                  const f = finds.filter((r) => r[0] === x.id);
                  const done = st.startsWith('Resolved');
                  return (
                    <div className="iss" key={x.id}>
                      <div className="top"><b>{i + 1}. {x.title}</b><span className={'chip ' + x.prio[1]}>{x.prio[0]}</span><span className={'chip ' + statusCls(st)}>{st}</span></div>
                      <span className="small">Handled by {x.owner}{done ? ' · verified by re-test' : ''}</span>
                      <ul className="find">{f.length ? f.map(([, c, l, t], j) => <li key={j}><span className={'tag ' + c}>{l}</span><span>{t}</span></li>) : <li><span className="small">Not reached in this call.</span></li>}</ul>
                      <p className="nextstep"><b>Next:</b> {done ? x.next.done : x.next.open}</p>
                    </div>
                  );
                })}
                <div><h3 style={{ marginBottom: 8 }}>Tests performed</h3><div className="tbl"><table><thead><tr><th>Issue</th><th>Test</th><th>Result</th><th>Ran in</th></tr></thead><tbody>
                  {tests.length ? tests.map((t, i) => <tr key={i}><td className="m">{t.issue.slice(1)}</td><td>{t.label}</td><td className="m">{t.result}</td><td className="m">{t.src}</td></tr>) : <tr><td colSpan={4} className="small">No tests ran.</td></tr>}
                </tbody></table></div></div>
              </div>
              <div style={{ display: 'grid', gap: 18 }}>
                <div className="card">
                  <h3>Business impact</h3>
                  <div><span className="small">Checkout outage measured in this session (first failed test → verified re-test)</span><div className="bigv">{down ? clock(down) + ' min' : 'Not measured'}</div></div>
                  <div><span className="small">Estimated checkout revenue at risk during the session</span><div className="bigv">{rev ? money(risk) : 'No revenue provided'}</div></div>
                  <p className="small">{sla && down ? `This outage counted ${(down / 60000).toFixed(1)} of ${slaMonthMin.toFixed(1)} monthly downtime minutes allowed at ${sla}%.` : sla ? `SLA ${sla}%: ${slaMonthMin.toFixed(1)} downtime minutes allowed per month.` : 'No SLA on this site.'}</p>
                </div>
                <div className="card"><h3>Email setup message</h3>{fixShown ? fixCard : <p className="small">Not prepared in this call.</p>}</div>
                <div className="card"><h3>Timeline</h3><ol className="timeline">{events.map((e, i) => <li key={i}><time>{clock(e.t)}</time><span>{e.label}</span></li>)}</ol></div>
                <div className="card">
                  <h3>Forward to your developer or IT contact</h3>
                  <pre className="plain">{plain()}</pre>
                  <div className="row-btns"><button className="btn" type="button" onClick={copySummary}>Copy summary</button><button className="btn ghost" type="button" onClick={() => { setToast(''); setScreen('intake'); }}>Start a new case</button></div>
                  <div className="toast" aria-live="polite">{toast}</div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
