# REVIEW CHECKLIST — sanity-checking GPT's decisions

Use this before accepting GPT's code or a design choice. If any red flag
appears, bring it (and the relevant code/answer) back to Claude to verify.

## Red flags — stop and double-check if GPT does any of these
- [ ] Adds a framework (React/Vue/Angular/Next) — violates DECISIONS. Ask why.
- [ ] Adds a big library for something WebRTC/the browser already does
      (e.g. its own signaling framework, a media SDK, a state library).
- [ ] Introduces Python/Flask or a second backend language.
- [ ] Writes its own congestion control, bandwidth estimator, FEC, NACK,
      jitter buffer, or packet scheduler — forbidden; the browser owns these.
- [ ] Requests microphone/camera permission on page load instead of after
      the user clicks Start.
- [ ] Hardcodes camera resolutions instead of negotiating constraints and
      degrading gracefully.
- [ ] Polls getStats() aggressively (e.g. every 100-250ms) or keeps polling
      when the tab is hidden. Target ~1 Hz, active-call only, paused when hidden.
- [ ] Stores room/user data in a database or keeps it after disconnect.
- [ ] Uses a guessable/short room ID, or logs room IDs.
- [ ] Relies on a Cloudflare feature that is NOT on the free tier without
      telling you (especially Durable Objects — confirm free-tier eligibility).
- [ ] Claims "fully deterministic" behavior for the network. Only the app's
      decision logic is deterministic; the network is not.
- [ ] Silently assumes TURN, or silently assumes STUN-only always connects.
      Both are decisions that must be explicit.

## Good signs — GPT is on track
- [ ] Total code stays in ~4-5 files, ~1000 lines, zero runtime dependencies.
- [ ] Uses native browser APIs: RTCPeerConnection, getUserMedia, getStats,
      Page Visibility, WebSocket.
- [ ] Reacts to connectivity via events (connectionstatechange,
      iceconnectionstatechange) and only samples quality metrics periodically.
- [ ] Adjusts quality only via setParameters (maxBitrate, scaleResolutionDownBy,
      maxFramerate) and degradationPreference — caps, not transport control.
- [ ] Cleans up on call end: stops tracks, closes peer connection, clears timers.

## Bring-to-Claude packet
When you want a second opinion, paste to Claude:
1. What GPT proposed (the answer or the code).
2. Which phase (from ROADMAP.md) it belongs to.
3. Any red flag above that it tripped.
4. The exact behavior you saw when testing, if relevant.

## Standing questions to ask GPT at each phase
- "What does the browser already do here that we should not reimplement?"
- "What happens on a symmetric NAT / corporate network with STUN only?"
- "Where is every resource freed when the call ends?"
- "Is every feature you added on the free tier?"
