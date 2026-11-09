"""Re-cuts the pitch's live-demo clips from a new screen recording + its ElevenLabs call.
Usage (repo root): python3 scripts/remake-clips.py <recording.mov> <conversation_id>
Offset = call start (ElevenLabs) - recording start (macOS file name, local time)."""
import json, re, subprocess, sys, pathlib, datetime

rec, cid = sys.argv[1], sys.argv[2]
V = pathlib.Path("AOB/video"); P = V / "pres"
conv = json.loads((V / f"{cid}.json").read_text())
m = re.search(r"at (\d+)\.(\d+)\.(\d+)\D*(AM|PM)", pathlib.Path(rec).name)
h, mi, se = int(m[1]), int(m[2]), int(m[3]); h = h % 12 + (12 if m[4] == "PM" else 0)
call_start = datetime.datetime.fromtimestamp(conv["metadata"]["start_time_unix_secs"])
rec_start = call_start.replace(hour=h, minute=mi, second=se)
OFF = (call_start - rec_start).total_seconds() + 0.4  # first agent line shows ~0.4 s after call start
print("offset", OFF)

msgs = [x for x in conv["transcript"] if (x.get("message") or "").strip() and x["message"].strip() != "..."]
users = [x["time_in_call_secs"] for x in msgs if x["role"] == "user"]
nora = next(x["time_in_call_secs"] for x in msgs if x["role"] == "agent" and x["message"].startswith("Hi, I'm Nora"))
CROP = "crop=2511:1412:204:380,scale=1920:1080,fps=30,setsar=1"

def cut(a, d, speed, out):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a + OFF:.2f}", "-t", f"{d:.2f}", "-i", rec, "-vf", f"{CROP},setpts=PTS/{speed:.3f}", "-an",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", str(out)], check=True)

u1, u2, u3 = users[0], users[1], users[2]
cut(u1 - 0.5, 31.0, 2.0, P / "clip4.mp4")
cut(u2 - 6.2, 12.6, 1.0, P / "clip_token.mp4")
span = (nora + 6) - (u3 - 3.5)
cut(u3 - 3.5, span, span / 14.6, P / "clip5.mp4")

# Token clip audio: agent audio + caller clip c2 placed so it ends at u2+0.5.
c2 = "web/public/caller/c2.mp3"
d2 = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", c2]).decode())
a0 = u2 - 6.2
delay = int(max(0, (u2 + 0.5 - d2) - a0) * 1000)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a0:.2f}", "-t", "12.6", "-i", str(V / f"{cid}.mp3"), "-i", c2, "-filter_complex",
                f"[0:a]aresample=48000[a];[1:a]aresample=48000,adelay={delay}:all=1[b];[a][b]amix=inputs=2:normalize=0:duration=first,afade=t=in:d=0.08,afade=t=out:st=12.4:d=0.2[o]",
                "-map", "[o]", "-ac", "2", str(P / "token.wav")], check=True)
refusal = next((x["message"] for x in msgs if x["role"] == "agent" and x["time_in_call_secs"] >= u2), "")
(P / "token_text.json").write_text(json.dumps({"maya": " ".join(refusal.split()[:24])}))
print("clips ready", u1, u2, u3, nora)
