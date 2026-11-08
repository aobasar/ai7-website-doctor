// Static case definitions: the three issues, their hypotheses and playbooks.
// States are driven at runtime by real tool calls from the voice agent.
export type IssueId = 'I1' | 'I2' | 'I3';
export type AgentKey = 'maya' | 'nora';

export const AGENTS: Record<AgentKey, { name: string; role: string; init: string; cls: string }> = {
  maya: { name: 'Maya', role: 'Web & Cloud Specialist', init: 'M', cls: '' },
  nora: { name: 'Nora', role: 'Networking Specialist', init: 'N', cls: 'nora' },
};

export interface Issue {
  id: IssueId;
  title: string;
  prio: [string, string];
  owner: string;
  why: string;
  hyps: [string, string][];
  pb: [string, string, string, string][]; // id, kind, text, rule
  next: { done: string; open: string };
}

export const ISSUES: Issue[] = [
  {
    id: 'I1', title: 'Checkout shows Bad Gateway', prio: ['Critical', 'crit'], owner: 'Maya', why: 'Losing sales right now',
    hyps: [['H1', 'DNS sends some visitors to the wrong host'], ['H2', 'Checkout code broken on the server'], ['H3', 'CDN is serving a cached error page']],
    pb: [['T1', 'Test', 'DNS: shop + www', 'Pass: both resolve to the same edge'], ['T2', 'Test', 'Checkout page', 'Pass: 2xx within 5 s'], ['T3', 'Test', 'Checkout with cache bypassed (origin)', 'Pass: 2xx from origin'], ['A1', 'Action', 'Customer purges /checkout from the CDN', ''], ['V1', 'Verify', 'Re-test checkout', 'Pass: 2xx, fresh copy']],
    next: { done: 'Ask your developer to make sure the CDN never caches 5xx responses before the next deploy.', open: 'Escalate to your CDN or hosting provider with these test results.' },
  },
  {
    id: 'I2', title: 'Order emails go to spam', prio: ['High', 'high'], owner: 'Maya', why: 'Customers miss order confirmations',
    hyps: [['H1', 'MX still points to the old mail provider'], ['H2', "SPF doesn't authorize Google to send"], ['H3', 'No DMARC policy published']],
    pb: [['T1', 'Test', 'MX records', 'Pass: point to the current provider'], ['T2', 'Test', 'SPF record', 'Pass: includes the current provider'], ['T3', 'Test', 'DMARC record', 'Pass: record exists'], ['A1', 'Action', 'Send setup message with the fixes', ''], ['V1', 'Verify', 'Re-check records after DNS updates', 'Pass: SPF includes Google, DMARC exists']],
    next: { done: 'Records verified. Watch your spam reports for a week.', open: 'Add the two DNS records from the setup message and turn on DKIM in Google Admin, then ask for a re-check.' },
  },
  {
    id: 'I3', title: 'Laptop Wi-Fi keeps dropping', prio: ['Normal', 'norm'], owner: 'Nora', why: 'One device, office productivity',
    hyps: [['H1', 'The problem is your website, not the laptop'], ['H2', 'Internet provider outage'], ['H3', 'Weak or crowded 2.4 GHz Wi-Fi link']],
    pb: [['T1', 'Test', 'Browser network test (20 requests)', 'Pass: 0 failed, jitter under 50 ms'], ['Q1', 'Question', 'Which Wi-Fi band are you on?', ''], ['A1', 'Action', 'Switch to 5 GHz and forget 2.4 GHz', ''], ['V1', 'Verify', 'Re-run browser network test', 'Pass: 0 failed, jitter under 50 ms']],
    next: { done: 'Keep the laptop on 5 GHz. If drops come back, restart the router and send this case to your internet provider.', open: 'Try a wired connection and contact your internet provider with this case.' },
  },
];

export const HYP_LABEL: Record<string, [string, string]> = { open: ['Open', 'norm'], out: ['Ruled out', 'norm'], likely: ['Likely', 'high'], conf: ['Confirmed', 'ok'] };

export const DEFAULT_ISSUE_TEXT =
  'We moved to new office internet this weekend. Since this morning, checkout on our store shows "Bad Gateway" for most customers. Our order-confirmation emails land in spam since we switched to Google Workspace. And my laptop\'s Wi-Fi keeps dropping.';

export const issueById = (id: IssueId) => ISSUES.find((x) => x.id === id)!;
export const statusCls = (s: string) => (s.startsWith('Resolved') ? 'ok' : s.startsWith('Waiting') ? 'high' : s === 'Queued' ? 'norm' : s.startsWith('Escalation') ? 'crit' : 'info');
