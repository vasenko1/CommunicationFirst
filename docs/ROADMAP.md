# ROADMAP — build one phase at a time

Work top to bottom. Each phase has: goal, the prompt to paste to GPT,
and the "done when" test. Full acceptance detail is in VERIFICATION.md.

Suggested file layout (keep it this small):

```
CommunicationProject/
  frontend/
    index.html
    style.css
    app.js
  worker/
    worker.js
  docs/
```

---

## Phase 0 — Environment (Mac)
**Goal:** tools ready.

Check in Terminal:
```
node -v
npm -v
git --version
```
If Node is missing: `brew install node`.

**Done when:** all three print version numbers.

---

## Phase 1 — Live page behind a link
**Goal:** a page with one "Start Call" button, published on the internet.

Prompt to GPT:
> Create a minimal static site: three files — index.html, style.css, app.js.
> One large centered "Start Call" button, readable on mobile. No libraries,
> no framework. Then give me step-by-step instructions to publish it free via
> GitHub + Cloudflare Pages and get a permanent URL. I am non-technical; tell
> me exactly what to click.

**Done when:** you open the URL on your phone over mobile data and see the button.

---

## Phase 2 — Signaling server (matchmaker)
**Goal:** a tiny server that introduces two browsers. It does NOT carry audio.

Prompt to GPT:
> Build a minimal WebRTC signaling server on Cloudflare Workers using
> WebSocket and Durable Objects. A client creates a room with a random
> high-entropy ID; a second client joins the same room; the server relays
> SDP offer/answer and ICE candidates between them. Max two peers per room —
> reject the third. No database, nothing persisted after disconnect. Give me
> full code and free-tier deploy steps. First confirm Durable Objects work on
> the free plan; if not, propose a free WebSocket alternative.

**Done when:** GPT shows the server is live and responds.

---

## Phase 3 — Voice call ⭐ (the core proof)
**Goal:** two people in different networks hear each other.

Prompt to GPT:
> Combine everything into a 1-on-1 voice call on plain WebRTC, no libraries.
> A clicks "Start Call" -> room created, invite link shown. B opens the link ->
> joins the same room. Establish an audio-only WebRTC connection using my
> signaling server. ICE config: Google STUN only (stun.l.google.com:19302),
> no TURN. Request microphone permission ONLY after the button click, never on
> page load (autoplay/permission rules). Use Trickle ICE. Show simple status:
> "Connecting..." / "Connected" / "Call ended". Give me a test procedure.

If it will not connect across networks, paste this:
> Show iceConnectionState and connectionState on screen so I can see which
> step it gets stuck on, and explain what the value I see means.

**Done when:** you and another person, on **different networks**
(you on Wi-Fi, them on mobile data), talk for 2+ minutes, clearly.

---

## Phase 4 — Measure where it breaks ⭐⭐ (the real deliverable)
**Goal:** get your real Connection Success Rate. See VERIFICATION.md for the table.

Ask 10-20 people on varied networks (home Wi-Fi, mobile, office/corporate, cafe)
to try connecting. Record: connected yes/no, their network type, audio ok, and
whether drops auto-recovered.

**Done when:** you have "connected N of 20" and know your failure rate.
- ~5% fail -> STUN-only is fine, stay free.
- 15-20% fail -> TURN is needed (the one paid piece; you now know the price).

---

## Phase 5 — Auto-recovery
**Goal:** short network drops don't kill the call.

Prompt to GPT:
> Add automatic reconnection: on iceConnectionState "disconnected"/"failed",
> attempt an ICE restart and re-negotiate without user action. Show
> "Reconnecting..." then "Connected". Do not tear down the call on the first
> failure; only give up after a bounded number of timed attempts.

**Done when:** you turn Wi-Fi off for 5s mid-call and it resumes on its own.

---

## Phase 6 — Video (must never break voice)
**Goal:** add video with voice always protected.

Prompt to GPT:
> Add optional video (camera on/off). Voice must never be sacrificed for video.
> Under constraint, reduce video first (lower resolution/framerate/bitrate via
> RTCRtpSender.setParameters and degradationPreference), then disable video,
> keeping audio intact. Drive decisions from getStats() qualityLimitationReason,
> sampled at ~1 Hz only during an active call and paused when the tab is hidden
> (Page Visibility API). Do not implement your own congestion control.

**Done when:** with Chrome's network throttling on, video degrades or drops
but voice stays understandable.

---

## Phase 7 — TURN decision (not coding — a decision)
Use the Phase-4 numbers. Few failures -> ship free. Many failures -> add a
TURN server (managed pay-per-traffic, or self-hosted coturn on a cheap VPS,
~EUR 5-20/mo at test scale). You are paying only for the calls that otherwise
would not connect at all.
