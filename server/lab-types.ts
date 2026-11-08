// Shared contract between the API routes and the Daytona lab.
// The lab is a reproducible copy of the demo customer's stack (origin server,
// caching CDN proxy, authoritative DNS) running inside a Daytona sandbox.
// Probes are fixed, read-only commands executed inside Daytona; the agent can
// only pick a probe name, never a command or an arbitrary target.

export type IssueId = 'I1' | 'I2' | 'I3';

export type ProbeName =
  | 'dns_shop'              // I1: A records for shop + www
  | 'http_checkout'         // I1: GET /checkout through the CDN
  | 'http_checkout_origin'  // I1: GET /checkout straight from origin (cache bypass)
  | 'mx'                    // I2: MX records
  | 'spf'                   // I2: SPF TXT record
  | 'dmarc';                // I2: DMARC TXT record

export const PROBES: Record<ProbeName, { issue: IssueId; label: string; rule: string }> = {
  dns_shop: { issue: 'I1', label: 'DNS: shop + www', rule: 'Pass: both resolve to the same edge' },
  http_checkout: { issue: 'I1', label: 'GET /checkout', rule: 'Pass: 2xx within 5 s' },
  http_checkout_origin: { issue: 'I1', label: 'GET /checkout (cache bypass)', rule: 'Pass: 2xx from origin' },
  mx: { issue: 'I2', label: 'MX lookup', rule: 'Pass: points to the current provider (Google)' },
  spf: { issue: 'I2', label: 'SPF (TXT)', rule: 'Pass: includes _spf.google.com' },
  dmarc: { issue: 'I2', label: 'DMARC (TXT _dmarc)', rule: 'Pass: record exists' },
};

export interface ProbeResult {
  probe: ProbeName;
  issue: IssueId;
  label: string;
  target: string;
  ok: boolean;
  result: string;      // one-line human summary, e.g. "502 Bad Gateway · x-cache: HIT · age 2940 s"
  ms: number;          // probe duration inside the sandbox
  sandboxId: string;   // Daytona sandbox that ran the probe (shown as evidence)
  raw?: string;        // trimmed raw output for the evidence panel
  simulated?: boolean; // true only if Daytona was unreachable and a labelled fallback was used
  error?: string;
}

export type LabAction =
  | 'purge_checkout_cache' // customer purges /checkout in the "CDN dashboard"
  | 'fix_email_dns'        // customer adds the SPF + DMARC records from the setup message
  | 'reset';               // put the lab back into the broken starting state

export interface LabActionResult { ok: boolean; detail: string }
