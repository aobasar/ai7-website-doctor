// M0 spike 2: does outbound traffic go through a proxy (env vars), and can curl reach allowlisted hosts?
import { Daytona } from '@daytona/sdk';
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY, apiUrl: process.env.DAYTONA_API_URL, target: process.env.DAYTONA_TARGET });
const sb = await daytona.create({ language: 'python', autoStopInterval: 15, labels: { app: 'ai7-spike' } });
try {
  const run = async (c) => (await sb.process.executeCommand(c, undefined, undefined, 30)).result;
  console.log('ENV:\n' + await run('env | grep -i -E "proxy|dns" ; cat /etc/resolv.conf'));
  for (const u of ['https://github.com', 'https://vercel.com', 'https://api.elevenlabs.io/v1/models', 'https://example.com', 'https://1.1.1.1']) {
    console.log(u, '=>', (await run(`curl -s -o /dev/null -m 8 -w "%{http_code} %{time_total}s %{remote_ip}" ${u} 2>&1; echo " exit=$?"`)).trim());
  }
} finally { await sb.delete(); }
