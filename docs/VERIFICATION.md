# VERIFICATION — how to prove each phase really works

Passing "it worked on my machine" is not acceptance. Use these.

## The one rule that matters
Test across **real, different networks**. Two tabs on one computer, or two
devices on the same Wi-Fi, will almost always connect and prove nothing.
The interesting cases are: you on home Wi-Fi + partner on mobile data,
someone on a corporate/office network, someone on cafe Wi-Fi.

## Per-phase acceptance
- **P1 Page:** URL opens on a phone over mobile data; button visible.
- **P2 Signaling:** server responds; a 3rd peer joining a full room is rejected.
- **P3 Voice:** 2 people, different networks, 2+ min, audio clear.
- **P4 Measurement:** table below filled for 10-20 attempts.
- **P5 Recovery:** Wi-Fi off 5s mid-call -> auto-resumes, no button press.
- **P6 Video:** throttle network -> video degrades/stops, voice stays clear.

## Phase 4 measurement table (copy into a spreadsheet)

| # | Tester network (theirs) | Your network | Connected? | Audio OK? | Dropped? | Auto-recovered? | Notes |
|---|-------------------------|--------------|-----------|-----------|----------|-----------------|-------|
| 1 | mobile data             | home Wi-Fi   | yes/no    | yes/no    | yes/no   | yes/no          |       |
| 2 | office / corporate      |              |           |           |          |                 |       |
| 3 | home Wi-Fi              |              |           |           |          |                 |       |
| ...|                         |              |           |           |          |                 |       |

**Result to compute:** connected ___ of ___ = ___ % success.
Corporate/office and some mobile networks are where STUN-only fails
(symmetric NAT / blocked UDP). That failure count is your TURN decision.

## Objective signals worth reading (from getStats(), during a call)
These are browser-provided and real; prefer them over any custom metric:
- `qualityLimitationReason` ("bandwidth" / "cpu" / "none") — why quality dropped
- `packetsLost`, `jitter`, `roundTripTime`
- `framesPerSecond`, `frameWidth`/`frameHeight`
- `freezeCount`, `totalFreezesDuration`

## What we deliberately do NOT try to measure in-browser
Battery %, exact CPU %, and RAM are not reliably exposed to web pages across
Chrome/Edge/Safari (Battery Status API is unavailable/removed; per-process CPU
is not exposed). Measure those, if ever, on a real device with OS tools — never
gate a release on a number the browser cannot give you.
