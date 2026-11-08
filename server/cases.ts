// In-memory case store with a small state machine.
// Rule: a case issue can only become "Resolved · Verified" when the latest
// test for that issue passed AND an earlier test for that issue failed.
import { randomUUID } from 'node:crypto';
import type { IssueId, ProbeResult } from './lab-types.js';

export const VERIFIED = 'Resolved · Verified';
export const ALLOWED_STATUSES = [
  'Diagnosing',
  'Waiting for customer',
  'Verifying',
  'Waiting for DNS',
  VERIFIED,
  'Escalation required',
] as const;
export type CaseStatus = (typeof ALLOWED_STATUSES)[number];

interface TestRecord { issue: IssueId; ok: boolean; at: number; label: string }
interface Case {
  id: string;
  createdAt: number;
  tests: TestRecord[];
  status: Partial<Record<IssueId, CaseStatus>>;
  probes: ProbeResult[];
}

const cases = new Map<string, Case>();

export function createCase(): Case {
  const c: Case = { id: 'A7-' + randomUUID().slice(0, 6).toUpperCase(), createdAt: Date.now(), tests: [], status: {}, probes: [] };
  cases.set(c.id, c);
  return c;
}

export function getCase(id: unknown): Case | undefined {
  return typeof id === 'string' ? cases.get(id) : undefined;
}

export function recordProbe(c: Case, r: ProbeResult) {
  c.probes.push(r);
  // A simulated or errored probe is not evidence and never counts toward verification.
  if (!r.simulated && !r.error) c.tests.push({ issue: r.issue, ok: r.ok, at: Date.now(), label: r.label });
}

export function recordBrowserTest(c: Case, ok: boolean) {
  c.tests.push({ issue: 'I3', ok, at: Date.now(), label: 'Browser network test' });
}

export function requestStatus(c: Case, issue: IssueId, status: string): { accepted: boolean; status?: CaseStatus; reason?: string } {
  if (!(ALLOWED_STATUSES as readonly string[]).includes(status)) {
    return { accepted: false, reason: `Unknown status "${status}". Allowed: ${ALLOWED_STATUSES.join(', ')}` };
  }
  if (status === VERIFIED) {
    const t = c.tests.filter((x) => x.issue === issue);
    const last = t[t.length - 1];
    const failedBefore = t.slice(0, -1).some((x) => !x.ok);
    if (!last || !last.ok || !failedBefore) {
      return { accepted: false, reason: 'No passing test since the last failure' };
    }
  }
  c.status[issue] = status as CaseStatus;
  return { accepted: true, status: status as CaseStatus };
}
