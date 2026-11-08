// M0 spike: how fast does a Daytona sandbox start, which hosts can it reach,
// and is a public preview URL reachable from outside and from inside a sandbox?
// Run: node --env-file=.env.local scripts/spike-daytona.mjs
import { Daytona } from '@daytona/sdk';

const ms = (t) => `${Date.now() - t} ms`;
const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  apiUrl: process.env.DAYTONA_API_URL,
  target: process.env.DAYTONA_TARGET,
});

let t = Date.now();
const sb = await daytona.create({
  language: 'python',
  public: true,
  autoStopInterval: 15,
  labels: { app: 'ai7-spike' },
});
console.log('create:', ms(t), 'id:', sb.id);

try {
  await sb.process.createSession('srv');
  await sb.process.executeSessionCommand('srv', { command: 'python3 -m http.server 8080', runAsync: true });
  const preview = await sb.getPreviewLink(8080);
  console.log('preview url:', preview.url);
  await new Promise((r) => setTimeout(r, 1500));

  const targets = [
    'https://vercel.com',
    'https://github.com',
    'https://example.com',
    'https://www.wikipedia.org',
    preview.url,
    'https://nonexistent-ai7-demo.invalid',
  ];
  const code = `
import json, socket, time, urllib.request, urllib.parse
out = []
for url in ${JSON.stringify(targets)}:
    host = urllib.parse.urlparse(url).hostname
    row = {"url": url}
    t = time.time()
    try:
        row["dns"] = sorted({a[4][0] for a in socket.getaddrinfo(host, 443)})[:2]
    except Exception as e:
        row["dns_error"] = type(e).__name__ + ": " + str(e)[:80]
    row["dns_ms"] = int((time.time() - t) * 1000)
    t = time.time()
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ai7-spike"}), timeout=6)
        row["http"] = r.status
    except urllib.error.HTTPError as e:
        row["http"] = e.code
    except Exception as e:
        row["http_error"] = type(e).__name__ + ": " + str(e)[:80]
    row["http_ms"] = int((time.time() - t) * 1000)
    out.append(row)
try:
    import dns.resolver
    row = {"dnspython": "installed"}
except Exception:
    row = {"dnspython": "missing"}
out.append(row)
print(json.dumps(out, indent=1))
`;
  t = Date.now();
  const r = await sb.process.codeRun(code);
  console.log('codeRun:', ms(t), 'exit:', r.exitCode);
  console.log(r.result);

  t = Date.now();
  const r2 = await sb.process.executeCommand('dig +short TXT google.com 2>&1 | head -3; which dig nslookup host 2>&1', undefined, undefined, 15);
  console.log('dig:', ms(t), r2.result);

  t = Date.now();
  const res = await fetch(preview.url, { redirect: 'manual' });
  const body = await res.text();
  console.log('preview from this Mac:', res.status, ms(t), 'location:', res.headers.get('location'));
  console.log(body.slice(0, 300).replace(/\s+/g, ' '));
} catch (e) {
  console.error('spike error:', e?.message || e);
} finally {
  t = Date.now();
  await sb.delete();
  console.log('delete:', ms(t));
}
