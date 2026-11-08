"""Builds the ~2 minute demo video from the screen recording, the real ElevenLabs
call audio, the caller clips (founder's voice clone) and the narration.
Output: AOB/video/website-doctor-demo.mp4 + .srt
Run from the repo root: python3 scripts/make-video.py
"""
import json, re, subprocess, pathlib

V = pathlib.Path("AOB/video")
REC = V / "rec3.mov"
CONV = "conv_6701m6yppb1hfsv8nj2n7tjaw65s"
OFFSET = 47.2  # recording time of call second 0 (first agent line appears 47.0-47.5 s)
CROP = "crop=2640:1485:195:349,scale=1920:1080,fps=30,setsar=1"
CALLER_DIR = pathlib.Path("web/public/caller")

# Kept parts of the call, in call seconds.
SEGMENTS = [(0.0, 13.7), (15.3, 28.5), (47.4, 60.0), (67.8, 77.5), (96.5, 106.0), (129.0, 137.0)]
INTRO_REC = (2.0, 44.0)    # intake + triage, sped up under the intro narration
OUTRO_REC = (250.0, 292.0)  # case summary scroll, sped up under the outro narration


def run(cmd):
    subprocess.run(cmd, check=True)


def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)]).decode().strip())


conv = json.loads((V / f"{CONV}.json").read_text())
msgs = [m for m in conv["transcript"] if (m.get("message") or "").strip() and m["message"].strip() != "..."]

# 1) Caller clips: each clip ends right when its text reached the agent.
users = [m for m in msgs if m["role"] == "user"]
clips = []
for i, m in enumerate(users, start=1):
    clip = CALLER_DIR / f"c{i}.mp3"
    d = dur(clip)
    clips.append((clip, m["time_in_call_secs"] + 0.5 - d, d, m["message"]))

proxy = V / "rec3_proxy.mp4"
if not proxy.exists():
    run(["ffmpeg", "-v", "error", "-y", "-i", str(REC), "-vf", CROP, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", str(proxy)])

mix = V / "call_mix.wav"
inputs = ["-i", str(V / f"{CONV}.mp3")]
fc = []
for k, (clip, start, _, _) in enumerate(clips, start=1):
    inputs += ["-i", str(clip)]
    ms = max(0, int(start * 1000))
    fc.append(f"[{k}:a]aresample=48000,adelay={ms}:all=1,volume=0.95[c{k}]")
labels = "".join(f"[c{k}]" for k in range(1, len(clips) + 1))
fc.append("[0:a]aresample=48000[c0]")
fc.append(f"[c0]{labels}amix=inputs={len(clips) + 1}:normalize=0:duration=first[m]")
run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(fc), "-map", "[m]", "-ac", "2", str(mix)])

# 2) Assemble: intro, demo segments, outro.
intro_d, outro_d = dur(V / "intro.mp3"), dur(V / "outro.mp3")
parts, fc = [], []
k1 = (INTRO_REC[1] - INTRO_REC[0]) / intro_d
k2 = (OUTRO_REC[1] - OUTRO_REC[0]) / outro_d
AF = "aformat=sample_rates=48000:channel_layouts=stereo"
fc.append(f"[0:v]trim={INTRO_REC[0]}:{INTRO_REC[1]},setpts=(PTS-STARTPTS)/{k1:.4f}[v0]")
fc.append(f"[2:a]{AF},asetpts=PTS-STARTPTS[a0]")
for i, (a, b) in enumerate(SEGMENTS, start=1):
    fc.append(f"[0:v]trim={a + OFFSET}:{b + OFFSET},setpts=PTS-STARTPTS[v{i}]")
    fc.append(f"[1:a]atrim={a}:{b},asetpts=PTS-STARTPTS,{AF},afade=t=in:d=0.08,afade=t=out:st={b - a - 0.12:.2f}:d=0.12[a{i}]")
n = len(SEGMENTS) + 1
fc.append(f"[0:v]trim={OUTRO_REC[0]}:{OUTRO_REC[1]},setpts=(PTS-STARTPTS)/{k2:.4f}[v{n}]")
fc.append(f"[3:a]{AF},asetpts=PTS-STARTPTS[a{n}]")
fc.append("".join(f"[v{i}][a{i}]" for i in range(n + 1)) + f"concat=n={n + 1}:v=1:a=1[v][a]")
out = V / "website-doctor-demo.mp4"
run(["ffmpeg", "-v", "error", "-y", "-i", str(proxy), "-i", str(mix), "-i", str(V / "intro.mp3"), "-i", str(V / "outro.mp3"),
     "-filter_complex", ";".join(fc), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
     "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(out)])

# 3) Subtitles.
def ts(s):
    ms = int(round(s * 1000)); return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"

def parse_srt(p):
    out = []
    for block in p.read_text().strip().split("\n\n"):
        lines = block.splitlines()
        a, b = lines[1].split(" --> ")
        sec = lambda x: (lambda h, m, s: int(h) * 3600 + int(m) * 60 + float(s.replace(",", ".")))(*x.split(":"))
        out.append((sec(a), sec(b), " ".join(lines[2:])))
    return out

cues = list(parse_srt(V / "intro.srt"))
t_out = intro_d
handoff_t = next((m["time_in_call_secs"] for m in msgs if m["role"] == "agent" and m["message"].startswith("Hi, I'm Nora")), 1e9)
agent_msgs = [m for m in msgs if m["role"] == "agent"]
for a, b in SEGMENTS:
    seg = []
    for j, m in enumerate(agent_msgs):
        t0 = m["time_in_call_secs"]
        t1 = min(agent_msgs[j + 1]["time_in_call_secs"] if j + 1 < len(agent_msgs) else t0 + 12, t0 + 14)
        words = m["message"].split()
        chunks = [" ".join(words[i:i + 11]) for i in range(0, len(words), 11)]
        step = max(0.8, (t1 - t0) / max(1, len(chunks)))
        who = "Nora" if t0 >= handoff_t else "Maya"
        for c_i, c in enumerate(chunks):
            s, e = t0 + c_i * step, t0 + (c_i + 1) * step
            if e > a and s < b:
                seg.append((max(s, a), min(e, b), f"{who}: {c}"))
    for clip, start, d, text in clips:
        if start + d > a and start < b:
            seg.append((max(start, a), min(start + d, b), f"Customer: {text}"))
    for s, e, x in sorted(seg):
        cues.append((t_out + s - a, t_out + e - a, x))
    t_out += b - a
for s, e, x in parse_srt(V / "outro.srt"):
    cues.append((t_out + s, t_out + e, x))
(V / "website-doctor-demo.srt").write_text("\n".join(f"{i}\n{ts(s)} --> {ts(e)}\n{x}\n" for i, (s, e, x) in enumerate(cues, 1)))
print("video", out, f"{dur(out):.1f} s", "cues", len(cues))
