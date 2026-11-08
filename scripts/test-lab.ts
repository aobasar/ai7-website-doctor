// Automated end-to-end check of the Daytona lab: every probe, the fixes, and the re-tests.
// Run: npx tsx --env-file=.env.local scripts/test-lab.ts
import { runProbe, labAction, labStatus } from '../server/lab.js';
import type { ProbeName } from '../server/lab-types.js';
const expect = (name: string, cond: boolean, detail: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); if (!cond) process.exitCode = 1; };
const t0 = Date.now();
console.log('reset:', (await labAction('reset')).detail, `(${Date.now() - t0} ms incl. boot)`);
const want: [ProbeName, boolean][] = [['dns_shop', true], ['http_checkout', false], ['http_checkout_origin', true], ['mx', true], ['spf', false], ['dmarc', false]];
for (const [p, ok] of want) { const r = await runProbe(p); expect(`${p} before fix`, r.ok === ok, `${r.result} · ${r.ms} ms · ${r.sandboxId}${r.error ? ' · ' + r.error : ''}`); }
console.log('purge:', (await labAction('purge_checkout_cache')).detail);
const c = await runProbe('http_checkout'); expect('http_checkout after purge', c.ok, `${c.result} · ${c.ms} ms`);
console.log('fix email:', (await labAction('fix_email_dns')).detail);
for (const p of ['spf', 'dmarc'] as ProbeName[]) { const r = await runProbe(p); expect(`${p} after fix`, r.ok, `${r.result} · ${r.ms} ms`); }
console.log('reset:', (await labAction('reset')).detail);
console.log('status:', (await labStatus()).detail);
