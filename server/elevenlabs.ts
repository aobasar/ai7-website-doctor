// Server-side ElevenLabs helpers. The API key never reaches the browser:
// the browser gets a short-lived signed URL for one conversation.

export async function getSignedUrl(): Promise<{ signedUrl: string }> {
  const agentId = process.env.ELEVENLABS_AGENT_ID?.trim();
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new HttpError(500, 'ELEVENLABS_API_KEY is not set on the server.');
  if (!agentId) throw new HttpError(503, 'ELEVENLABS_AGENT_ID is not set yet. Create the agent, then restart the server.');
  const url = `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`;
  const res = await fetch(url, { headers: { 'xi-api-key': apiKey } });
  if (!res.ok) {
    const body = await res.text();
    throw new HttpError(502, `ElevenLabs refused the signed URL request (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { signed_url?: string };
  if (!data.signed_url) throw new HttpError(502, 'ElevenLabs returned no signed_url.');
  return { signedUrl: data.signed_url };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
