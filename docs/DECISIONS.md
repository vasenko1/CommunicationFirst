# DECISIONS — fixed project context

> Paste this whole file to any AI assistant at the start of a session.
> These are settled. If the assistant proposes changing one, it must
> justify it explicitly — otherwise keep it.

## Product
- Purpose: reliable 1-on-1 voice + video in a browser, over poor networks.
- Exactly **two** participants. One temporary room. No accounts.
- The room disappears when both leave. No history, no persistence.
- NOT in scope: chat, files, screen share, groups, recording, profiles,
  notifications, mobile/desktop native apps, any social feature.

## Supported targets
- Browsers: **Chrome, Edge, Safari only.** Ignore all others.
- Devices: desktop, Android phone, iPhone. Old/low-end hardware matters.
- Safari is the strictest target — if Safari can't do it reliably,
  it does not become a core dependency.

## Stack (settled)
- Frontend: **plain HTML + CSS + JavaScript. No framework** (no React/Vue/Angular).
- Signaling backend: **Cloudflare Workers + Durable Objects + WebSocket**.
  - ⚠️ Verify Durable Objects are available on your **free** plan before relying
    on them. If not, use a tiny Node WebSocket server on a free host
    (Render / Fly / Deno Deploy) instead.
- Connectivity: **WebRTC** with **Google public STUN** (`stun.l.google.com:19302`).
  **No TURN** in the free MVP (accept that some networks won't connect —
  we measure how many; see VERIFICATION.md).
- Tooling: VS Code + GitHub + Cloudflare. Node.js installed via Homebrew (Mac).
- Language everywhere: **JavaScript.** No Python / Flask.

## Responsibility split (do not violate)
- **Browser owns:** ICE, DTLS/SRTP encryption, codecs, congestion control,
  bandwidth estimation, packet loss recovery (FEC/NACK), jitter buffer, pacing.
  We do NOT reimplement any of these.
- **App owns:** conversation state, UI, enabling/disabling video,
  quality *ceilings* (max bitrate/resolution/fps via `setParameters`),
  `degradationPreference`, reconnection policy, resource cleanup.
- Rule: if the browser already solves it, do nothing. Never fight the browser.

## Cost model
- Everything free EXCEPT a possible TURN server later (bandwidth cost),
  only if the Phase-4 measurement proves it is needed.

## Security / privacy
- Room ID must be **high-entropy (>=128-bit), unguessable**, and acts as the
  access token. Server rejects a 3rd peer. Never log room IDs.
- Collect no user data. Measurement is done in lab/among testers, not by tracking.
