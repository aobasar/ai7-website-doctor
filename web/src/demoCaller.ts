// Demo caller: replaces the microphone with pre-generated caller clips.
// The clips are the founder's own voice clone (ElevenLabs TTS). Each clip plays
// into a fake microphone stream (heard by the agent) and to the speakers (heard
// by a screen recording). The agent's replies stay fully live.

export interface CallerLine { id: string; text: string; file: string }

let ctx: AudioContext | null = null;
let dest: MediaStreamAudioDestinationNode | null = null;
let installed = false;
let current: AudioBufferSourceNode | null = null;

export async function installFakeMic(): Promise<void> {
  if (!ctx) {
    ctx = new AudioContext();
    dest = ctx.createMediaStreamDestination();
  }
  await ctx.resume();
  if (installed) return;
  const md = navigator.mediaDevices;
  const original = md.getUserMedia.bind(md);
  md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    if (constraints?.audio && dest) return dest.stream;
    return original(constraints);
  };
  installed = true;
}

export async function loadCallerScript(): Promise<CallerLine[]> {
  try {
    const res = await fetch('/caller/script.json', { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function isCallerPlaying() { return current !== null; }

// toMic=false: the clip only plays to the speakers (for the recording) and the
// caller's words reach the agent as a text turn. Used when the browser's audio
// path to the agent is unreliable.
export async function playCallerLine(line: CallerLine, toMic = true): Promise<boolean> {
  if (!ctx || !dest) return false;
  try {
    const res = await fetch(line.file.startsWith('/') ? line.file : '/caller/' + line.file);
    if (!res.ok) return false;
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (toMic) src.connect(dest);
    src.connect(ctx.destination);
    current = src;
    await new Promise<void>((resolve) => { src.onended = () => resolve(); src.start(); });
    return true;
  } catch {
    return false;
  } finally {
    current = null;
  }
}

export function stopCaller() {
  try { current?.stop(); } catch { /* already stopped */ }
  current = null;
}
