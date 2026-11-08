// Website Doctor API + web server.
// Dev: Vite runs as middleware (one port). Prod: serves the built web/dist.
import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROBES, type IssueId, type LabAction, type ProbeName } from './lab-types.js';
import { labAction, labStatus, runProbe } from './lab.js';
import { createCase, getCase, recordBrowserTest, recordProbe, requestStatus } from './cases.js';
import { getSignedUrl, HttpError } from './elevenlabs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8010;
const PROD = process.env.NODE_ENV === 'production';
const LAB_ACTIONS: LabAction[] = ['purge_checkout_cache', 'fix_email_dns', 'reset'];
const ISSUES: IssueId[] = ['I1', 'I2', 'I3'];

const app = express();
app.use(express.json({ limit: '32kb' }));

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

app.get('/api/health', wrap(async (_req, res) => {
  res.json({ ok: true, lab: await labStatus() });
}));

app.get('/api/ping', (_req, res) => {
  res.set('Cache-Control', 'no-store').status(204).end();
});

app.get('/api/signed-url', wrap(async (_req, res) => {
  res.json(await getSignedUrl());
}));

// A new case puts the demo lab back into its broken starting state, so every
// run (live demo, recording, judges trying it) starts from the same facts.
app.post('/api/case', wrap(async (_req, res) => {
  const reset = await labAction('reset');
  res.json({ caseId: createCase().id, lab: reset });
}));

app.post('/api/diagnose', wrap(async (req, res) => {
  const { caseId, probe } = req.body ?? {};
  if (typeof probe !== 'string' || !(probe in PROBES)) {
    res.status(400).json({ blocked: true, reason: `"${String(probe)}" is not an approved diagnostic. Allowed: ${Object.keys(PROBES).join(', ')}` });
    return;
  }
  const c = getCase(caseId);
  if (!c) { res.status(404).json({ error: 'Unknown case' }); return; }
  const result = await runProbe(probe as ProbeName);
  recordProbe(c, result);
  res.json(result);
}));

app.post('/api/lab/action', wrap(async (req, res) => {
  const { action } = req.body ?? {};
  if (!LAB_ACTIONS.includes(action)) {
    res.status(400).json({ ok: false, detail: `Unknown action. Allowed: ${LAB_ACTIONS.join(', ')}` });
    return;
  }
  res.json(await labAction(action as LabAction));
}));

app.post('/api/case/status', (req, res) => {
  const { caseId, issue, status } = req.body ?? {};
  const c = getCase(caseId);
  if (!c) { res.status(404).json({ accepted: false, reason: 'Unknown case' }); return; }
  if (!ISSUES.includes(issue)) { res.status(400).json({ accepted: false, reason: 'Unknown issue' }); return; }
  res.json(requestStatus(c, issue as IssueId, String(status)));
});

app.post('/api/case/browser-test', (req, res) => {
  const { caseId, ok } = req.body ?? {};
  const c = getCase(caseId);
  if (!c) { res.status(404).json({ error: 'Unknown case' }); return; }
  recordBrowserTest(c, Boolean(ok));
  res.json({ recorded: true });
});

app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found' }); });

if (PROD) {
  const dist = path.join(ROOT, 'web', 'dist');
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: path.join(ROOT, 'web'), configFile: path.join(ROOT, 'vite.config.ts'), server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  console.error('[api]', message);
  res.status(status).json({ error: message });
});

app.listen(PORT, () => console.log(`Website Doctor on http://localhost:${PORT} (${PROD ? 'production' : 'dev'})`));
