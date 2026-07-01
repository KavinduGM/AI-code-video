// =====================================================================
// MOTION AUDIT — deterministic, multi-frame review of the RENDERED video
// =====================================================================
// The vision reviewer only ever sees a single still frame, so it is blind
// to motion: a scene that flickers or loops has a fine-looking final frame
// and passes. This module analyzes the "ink over time" signal (fraction of
// bright pixels per sampled frame, from ffmpeg.sampleInkFractions) to catch
// the two motion defects that single-frame review cannot:
//
//   - LOOP / FLICKER: content appears then disappears then reappears — the
//     ink amount rises, drops, and rises again.
//   - ALL-AT-ONCE: the whole composition is present from the first frame,
//     with no progressive reveal — ink jumps to full immediately.
//
// When it finds a defect it returns a SYSTEM-AUTHORED guided fix (what to
// do, not just the symptom) that feeds straight into the repair prompt.
// =====================================================================

export interface MotionVerdict {
  loop: boolean
  allAtOnce: boolean
  blank: boolean
  inks: number[]
  issues: string[]
}

const LOOP_GUIDE =
  'MOTION: one or more elements loop/flicker — they disappear and reappear during the scene ' +
  'instead of staying on screen. FIX: make EVERY animation play exactly ONCE and hold its final ' +
  'state. Use animation-iteration-count:1 and animation-fill-mode:both for CSS, repeat:0 and ' +
  'yoyo:false for GSAP, and remove any pulsing, blinking, glowing, breathing, or looping effect ' +
  '(including any "soft pop" written as a repeating pulse). Never use setInterval for visible ' +
  'motion. After each element reveals, it must remain fully visible and static until the scene ends.'

const STAGGER_GUIDE =
  'MOTION: all elements appear at once with no progressive reveal. FIX: stagger the reveals across ' +
  'the first ~70% of the scene. Give each text line and shape its own increasing start time — the ' +
  'heading first (~0.3s), then each following line about 0.6–1.0s after the previous one — each ' +
  'starting from opacity:0 and writing/fading in exactly once. Inside a box, reveal the box outline ' +
  'first, then its inner lines one after another (not all together).'

/**
 * Analyze the ink-over-time samples. Thresholds are deliberately conservative so
 * a normal write-on (ink climbs, then holds) passes, and only genuine looping or
 * instant-full compositions are flagged.
 */
export function analyzeMotion(inks: number[]): MotionVerdict {
  const issues: string[] = []
  const max = inks.length ? Math.max(...inks) : 0

  // Near-empty render — let the vision reviewer handle "nothing rendered".
  if (max < 0.003) {
    return { loop: false, allAtOnce: false, blank: true, inks, issues }
  }

  // LOOP: after content reaches a peak, does the ink drop well below that peak
  // (content vanished) at any later sample? A monotonic rise + hold never does.
  let peak = 0
  let loop = false
  for (const v of inks) {
    peak = Math.max(peak, v)
    if (peak > 0.01 && v < peak * 0.6) loop = true
  }

  // ALL-AT-ONCE: the composition reaches ~85% of its final ink by the 2nd sample.
  let riseIndex = inks.findIndex((v) => v >= 0.85 * max)
  if (riseIndex < 0) riseIndex = inks.length - 1
  const allAtOnce = inks.length >= 4 && riseIndex <= 1

  if (loop) issues.push(LOOP_GUIDE)
  if (allAtOnce) issues.push(STAGGER_GUIDE)

  return { loop, allAtOnce, blank: false, inks, issues }
}
