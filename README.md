# AI7 Tech Support · Website Doctor

**Don't just answer. Diagnose. Resolve. Verify.**

Website Doctor is a voice-first AI support desk for small businesses. The customer describes everything that's wrong in one sentence. An AI specialist, Maya, sorts the problems by business impact, talks the customer through them live, runs real diagnostic checks, shows the evidence on screen, and re-tests after every fix. A case can't be marked "Resolved · Verified" without a passing test.

Built solo by [Ahmet O. Basar](https://aobasar.com) at the [**SDxSDSU Voice Agent Hackathon**](https://luma.com/uan97kyo) (San Diego, November 8, 2026) with **ElevenLabs** and **Daytona**. All code in this repository was written during the event.

- **Video (1:42):** https://youtu.be/g_Q4sfF8djs
- **Live app:** https://ai7tech.aobasar.com (the demo login is prefilled, just click **Sign in**)
- **Hackathon:** https://luma.com/uan97kyo
- **More projects by the author:** https://aobasar.com

**Try it:** keep the prefilled problem, click **Start Support**, tick the consent box, tick **Demo caller** to hear the scripted customer (or leave it off and talk to Maya yourself), then **Start voice session**. Every new case resets the lab to its broken starting state.

## The demo case

A store owner moved to a new office internet connection and writes:

> Checkout shows "Bad Gateway" for most customers, our order emails land in spam since we switched to Google Workspace, and my laptop's Wi-Fi keeps dropping.

| # | Issue | Priority | Who | What happens |
|---|---|---|---|---|
| 1 | Checkout returns 502 | Critical (losing sales) | Maya | DNS ok → checkout 502 with `x-cache: HIT`, 49 min old → origin with cache bypassed returns 200 → the CDN is serving a cached error. Customer purges `/checkout`, Maya re-tests: 200, fresh copy. **Resolved · Verified.** A live "revenue at risk" counter stops. |
| 2 | Order emails go to spam | High | Maya | MX points to Google, but SPF only allows the old provider and DMARC is missing. Maya puts the exact records on screen, the customer adds them, Maya re-checks. **Resolved · Verified.** |
| 3 | Laptop Wi-Fi drops | Normal | Nora | Maya hands off to Nora with full context. Nora measures the connection from the customer's own browser (20 requests: latency, jitter, failures) and guides the fix. |

Guardrail moments in the demo: the customer offers an API token ("can't you just purge it yourself?") and Maya refuses; tests on private addresses are blocked; the server rejects a "Resolved" status that has no passing re-test.

## How it works

```
Browser (React + @elevenlabs/react)
  ├─ intake → triage (3 issues sorted by business impact)
  ├─ live voice session with the ElevenLabs agent (Maya → Nora)
  │    client tools: set_current_issue · run_diagnostic · customer_action
  │                  update_case_status · send_setup_message
  │                  run_browser_network_test · handoff_to_nora · end_case
  └─ evidence panel, hypotheses, playbook, case summary
Node API (Express)
  ├─ /api/signed-url   ElevenLabs signed URL (API key stays on the server)
  ├─ /api/diagnose     only approved probe names → Daytona
  ├─ /api/case/status  state machine: no "Resolved · Verified" without a passing re-test
  └─ /api/ping         target for the in-browser network test
Daytona
  └─ long-lived lab sandbox (auto-stop disabled) running a copy of the customer's
     stack: origin server, CDN proxy with a cache rule that stores 5xx errors,
     and authoritative DNS for the demo domain. Probes are fixed, read-only
     commands (dig, curl) executed inside the sandbox.
```

### Why Daytona

The agent never runs commands on our server or the customer's machine. It picks a probe name; the server maps it to a fixed, read-only command that executes inside an isolated Daytona sandbox, and the result comes back as evidence with the sandbox ID. The same sandbox hosts a reproducible lab of the customer's stack, so the demo uses real HTTP caching behavior and real DNS answers, and every fix (cache purge, new DNS records) really changes what the next test sees.

On Daytona's Tier 1 plan, sandboxes can't reach arbitrary internet hosts, which is also a good default for a support tool: customer-facing diagnostics should only touch approved targets. Checking real customer domains is the next step, behind domain verification.

### Why ElevenLabs

The ElevenLabs Agents Platform runs the whole conversation: speech in and out, turn-taking, interruptions, and client tool calls that drive the UI. Intake details reach the agent as dynamic variables, so Maya opens the call already knowing the problem. The agent is created and updated from code (`scripts/setup-agent.mjs`).

The demo caller's lines are generated with the founder's own ElevenLabs voice clone (`scripts/make-caller.mjs`); Maya's and Nora's side of the call is fully live.

## Guardrails

- The agent chooses from approved, read-only probes. No free-form commands, hosts or ports.
- Never asks for or accepts passwords, API tokens, 2FA codes or payment details.
- Private and local addresses are never tested.
- The customer performs every change themselves; the agent only verifies.
- Observations, likely causes and unverified hypotheses are labeled separately.
- Server-side status rules: "Resolved · Verified" requires a passing re-test after a failure.
- The voice session asks for transcription consent first (California is a two-party consent state).
- AI7 Tech Support is an independent service, not affiliated with Apple, Microsoft, Google or any hosting provider.

## Run it

```bash
cp .env.example .env.local   # fill in ElevenLabs + Daytona keys
npm install
npm run setup:agent          # creates the ElevenLabs agent, writes ELEVENLABS_AGENT_ID
npm run dev                  # http://localhost:8010
```

The first request boots the Daytona lab (about 8 seconds). Each new case resets the lab to its broken starting state.

On the review screen, **Demo caller** plays the scripted caller lines instead of using the microphone. The caller's lines are generated from the founder's own ElevenLabs voice clone (`npm run make:caller`); Maya's and Nora's side of every call is live.

## Deploy

The hosted demo runs from the `Dockerfile` on a Coolify server behind Cloudflare. Environment variables:

| Variable | Purpose |
|---|---|
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` | live agent and signed URLs |
| `DAYTONA_API_KEY`, `DAYTONA_API_URL`, `DAYTONA_TARGET` | Daytona sandboxes |
| `LAB_SANDBOX_ID` | reuse one long-lived lab sandbox (auto-stop disabled) instead of booting a new one |
| `APP_USER`, `APP_PASS_HASH` | login gate (`scrypt$salt$hash`); without them the gate is off |

The login gate (`server/auth.ts`) has per-IP and per-user lockout, a fixed delay on failed attempts, timing-safe comparisons and an HMAC-signed HttpOnly session cookie that lasts 30 days. For judging, the login form comes prefilled.

## Video pipeline

The pitch video is produced from code, no screen recording by hand:

1. `scripts/record-demo.mjs` drives the hosted app in headless Chrome (Playwright) through a full live call and records it.
2. `scripts/remake-clips.py` cuts the demo clips from that recording and the call audio fetched with `scripts/fetch-conversation.mjs`.
3. `scripts/make-pres-voice.mjs` narrates each chapter with ElevenLabs TTS; `scripts/stt-words.mjs` gets word timestamps from Scribe for word-by-word captions.
4. `scripts/make-pres.mjs` records the animated slides (`scripts/pitch-template.html`) with the clips, captions and speaker labels into the final MP4.

## Tests

```bash
npm run test:lab     # every probe, the fixes and the re-tests against the Daytona lab
npm run test:agent   # drives the live agent over WebSocket with the caller's lines,
                     # executes its tool calls against the lab, checks the tool sequence
npm run typecheck
```

## Project layout

```
server/        Express API, case state machine, Daytona lab client, login gate
lab/           lab_server.py: origin, caching edge proxy, DNS server (runs in Daytona)
web/           React app; web/public/caller/ holds the demo caller clips
scripts/       agent setup, caller clips, tests, demo recorder, video pipeline, Daytona spikes
Dockerfile     production image (used by Coolify)
```

## What's next

More specialists (computers, home networks), permissioned checks on real customer domains, a desktop companion app for device diagnostics, and handoff to human technicians for anything the AI can't verify.

## Author

Made by **Ahmet O. Basar**. Other projects and contact: **[aobasar.com](https://aobasar.com)**
