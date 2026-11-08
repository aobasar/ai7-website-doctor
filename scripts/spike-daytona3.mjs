// M0 spike 3: can one sandbox reach another sandbox's public preview URL? Can it do DNS TXT/MX lookups?
import { Daytona } from '@daytona/sdk';
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY, apiUrl: process.env.DAYTONA_API_URL, target: process.env.DAYTONA_TARGET });
const [a, b] = await Promise.all([
  daytona.create({ language: 'python', public: true, autoStopInterval: 15, labels: { app: 'ai7-spike' } }),
  daytona.create({ language: 'python', autoStopInterval: 15, labels: { app: 'ai7-spike' } }),
]);
try {
  await a.process.createSession('srv');
  await a.process.executeSessionCommand('srv', { command: 'python3 -m http.server 8080', runAsync: true });
  const p = await a.getPreviewLink(8080);
  await new Promise((r) => setTimeout(r, 1500));
  const run = async (c) => (await b.process.executeCommand(c, undefined, undefined, 30)).result.trim();
  console.log('B -> A preview:', await run(`curl -s -o /dev/null -m 8 -w "%{http_code} %{time_total}s" ${p.url}; echo " exit=$?"`));
  console.log('B -> A preview (headers):', await run(`curl -sI -m 8 ${p.url} | head -5`));
  console.log('resolv:', await run('cat /etc/resolv.conf | grep nameserver'));
  console.log('dig MX google.com:', await run('dig +short +time=3 +tries=1 MX google.com 2>&1 | head -3'));
  console.log('dig TXT google.com:', await run('dig +short +time=3 +tries=1 TXT google.com 2>&1 | head -2'));
  console.log('host -t A github.com:', await run('host -W 3 github.com 2>&1 | head -2'));
  console.log('python getaddrinfo github.com:', await run(`python3 -c "import socket;print(socket.getaddrinfo('github.com',443)[0][4])" 2>&1 | tail -1`));
  console.log('curl workers.dev:', await run('curl -s -o /dev/null -m 8 -w "%{http_code}" https://cloudflare-quic.workers.dev 2>&1; echo " exit=$?"'));
  console.log('curl vercel.app:', await run('curl -s -o /dev/null -m 8 -w "%{http_code}" https://nextjs.vercel.app 2>&1; echo " exit=$?"'));
} finally { await Promise.all([a.delete(), b.delete()]); }
