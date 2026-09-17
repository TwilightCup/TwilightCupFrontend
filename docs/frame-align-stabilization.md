# Frontend alignment stabilization

This change keeps HLS, the 30-second safety margin and the 1x / 2x catch-up rule.
It does not configure the server or guarantee identical frames across browsers.

## Implemented invariants

- A single serial HLS poll delivers complete segments in media-sequence order.
  LL-HLS parts are not delivered. GAP URIs are never requested. Failed init loads
  remain retryable; a failed segment blocks later delivery until retry exhaustion
  or playlist eviction marks a discontinuity. Stop aborts requests and ignores late results.
- Encoded samples remain in decode order. WebCodecs output timestamps identify
  SEI realtime_us; output is not associated through an input FIFO. Decoder
  generations discard late callbacks and failed reference chains restart at a keyframe.
- Raw storage retains up to 600 seconds, subject to 512 MiB / 72,000 samples per
  side. Eviction preserves the current target GOP and adjusts the decode cursor.
  If the protected data cannot fit, intake stops explicitly (`memoryBlocked`)
  instead of deleting frames needed for the target. Operator refresh is required.
  Decoded storage uses a small target window and a 128 MiB estimated budget.
  These are application estimates, not a bound on browser/GPU process memory.
- Parsing frontier, continuous encoded coverage, decoded coverage and actual
  presented timestamps are separate. Both configured sides must have candidates
  within 40 ms of T and within 40 ms of each other before common presentation.
  Canvas input draws are staged before visible copies in the same JS task.
  Missing candidates freeze committed T and mark both sides unready.
- No automatic large timeline jump: a discontinuity that removes the target from
  continuous coverage freezes playback. Explicit refresh can rebuffer/reanchor;
  operators should refresh both sides for a new common timeline.
- External anchors interpolate using local performance time, rate and optional
  same-server timing metadata. Old epoch/sequence/input timestamps are rejected;
  output never reverses. Extrapolation is capped at 1 second and anchors become
  stale after 1.5 seconds. An attached stale clock never falls back to local T.
  Legacy messages remain accepted with weaker ordering guarantees.
- Match overlay state and TopBar scores read a bounded frontend snapshot history
  at committed presentation time (also bounded by actual frame timestamps).
  No snapshot before the first received sample means waiting, not latest-state
  fallback. LiveTime.realTimeMs remains elapsed round time. Without an explicit
  timer-running/rate field, aligned timers hold historical samples, avoiding
  invented progress through pause/loading. Non-aligned playback is preserved.

## Deployment dependencies and remaining limits

1. MediaMTX must expose complete fMP4 video segments with SEI, usable init maps,
   browser CORS/auth and enough retention for outage/retry recovery. Validate the
   actual playlist span and URI retention; a recorded `hlsSegmentCount=360` is
   not evidence of deployment. Fetching stays near live and buffering is local,
   so 30-second display delay alone does not require fetching 30-second-old URLs.
   A short window still limits cold-start history and outage recovery.
2. Backend should preserve/assign authority epoch, monotonic sequence, rate,
   paused state and effective/server timestamps. Current frontend sends seq,
   rate and paused, accepts optional epoch/timing fields, and supports legacy
   relay. Authority changes need server selection; browser receive-time anchors
   still differ by network latency. No absolute cross-browser frame guarantee.
3. Full event correctness needs event_id/sequence, match/round IDs, event epoch
   in the SEI clock domain, timer-running/rate and replay covering the playback
   buffer. Receipt-time history is conservative only when client epoch clocks
   are aligned. Reconnect/reload cannot reconstruct unavailable past events.
   Other broadcast scenes still need a separate historical-state audit.
4. Existing MPEG-TS/Annex-B parsing and non-aligned fallback paths remain; this
   change does not implement new decoders/transports. Codec/hardware support,
   real MediaMTX retention and two-browser behavior need deployment validation.

## Validation

`npm run typecheck`, `npm test`, `npm run build`, `git diff --check`.
Node fixtures mock fetch and WebCodecs; they do not replace a browser decode test.
They cover poll overlap, parts/segments, GAP, retries, abort, B-frame output,
old callbacks, raw eviction beyond 20 minutes, protected budgets, decode failure,
common readiness, nearest bounds, external anchors, rate control, event history,
codec configuration isolation and session leases.

Deployment acceptance: run two B-frame streams for at least 30 minutes, induce
404/503, GAP, source restart, one-side interruption, authority disconnect and
background/foreground changes. While playing, both target errors and A/B error
must be <=40 ms, T must stay <=slow continuous frontier minus 30 seconds, and
T must never decrease. On missing data both readiness flags must drop without
one-side advancement. Inspect memory plateau, resync counters, rawBytes,
continuous/decoded coverage and presentedRt. Verify old scores/rounds remain
visible until their history time, and initial unavailable history stays blank.
