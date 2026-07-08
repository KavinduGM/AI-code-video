// =====================================================================
// RAW DOCUMENT DETECTION + NORMALISATION
// =====================================================================
// The factory accepts three shapes of raw upload and routes each:
//
//   'questions'  — an exam question bank (Q: / A) B) C) D) / CORRECT: /
//                  WHY CORRECT: / WHY A: …). Each question becomes a
//                  QUESTION SHORT (parsed deterministically here — no AI).
//   'storyboard' — a long teaching storyboard (Point N / VOICEOVER: /
//                  drawing cues, e.g. the "VisualCues" docs). The teaching
//                  content lives in the VOICEOVER lines; the factory hands
//                  the raw text to Claude to distil into `---` concepts.
//   'concepts'   — plain theory, ideally already `---`-separated. Used as-is.
//
// This module only DETECTS and PARSES (deterministic). Storyboard→concept
// distillation is a Claude call in factory.ts; question→script is a Claude
// call too, but the question DATA is parsed here with no AI so it stays
// faithful to the source.
// =====================================================================

export type DocType = 'questions' | 'storyboard' | 'concepts'

export interface ParsedQuestion {
  question: string
  options: string[] // in original A,B,C,… order
  correctIndex: number // 0-based
  whyCorrect: string
  whyWrong: string[] // aligned 1:1 with options ('' at the correct index)
}

/** Count non-overlapping matches of a global regex. */
function countMatches(text: string, re: RegExp): number {
  const m = text.match(re)
  return m ? m.length : 0
}

/**
 * Classify a raw upload. Question banks win first (the CORRECT: + lettered-
 * option signature is unambiguous), then storyboards (many VOICEOVER: lines),
 * else it's treated as plain concept theory.
 */
export function detectDocType(text: string): DocType {
  const correctMarks = countMatches(text, /^\s*CORRECT:\s*[A-Za-z]\b/gm)
  const optionLines = countMatches(text, /^\s*[A-Da-d]\)\s+\S/gm)
  const voiceovers = countMatches(text, /^\s*VOICEOVER\s*:/gim)

  // A real question bank has repeated CORRECT: answers each backed by options.
  if (correctMarks >= 2 && optionLines >= correctMarks * 2) return 'questions'
  // A storyboard is dominated by VOICEOVER lines (with no CORRECT answers).
  if (voiceovers >= 3 && correctMarks === 0) return 'storyboard'
  return 'concepts'
}

const LETTERS = 'ABCDEFGH'

/**
 * Parse a question bank into structured questions — deterministic, no AI, so
 * the answer and options stay exactly faithful to the source. Blocks that
 * don't carry a question + a valid CORRECT letter + at least two options are
 * skipped. Questions are separated by `---` lines, matching the export format.
 */
export function parseQuestions(text: string): ParsedQuestion[] {
  const blocks = text
    .split(/\r?\n\s*---+\s*\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean)

  const out: ParsedQuestion[] = []
  for (const block of blocks) {
    // Question stem: from "Q:" up to the first lettered option (handles a
    // stem that wraps across lines).
    const qm = /(?:^|\n)\s*Q\s*:\s*([\s\S]*?)\n\s*[A-Za-z]\)\s/.exec(block)
    if (!qm) continue
    const question = qm[1].replace(/\s+/g, ' ').trim()
    if (!question) continue

    // Options: "A) text" … in order. Capture the option text up to the next
    // option, a CORRECT line, a WHY line, or a blank line.
    const optRe = /^\s*([A-Za-z])\)\s*(.+?)\s*$/gm
    const letters: string[] = []
    const options: string[] = []
    let om: RegExpExecArray | null
    while ((om = optRe.exec(block)) !== null) {
      letters.push(om[1].toUpperCase())
      options.push(om[2].trim())
    }
    if (options.length < 2) continue

    const cm = /^\s*CORRECT\s*:\s*([A-Za-z])\b/m.exec(block)
    if (!cm) continue
    const correctLetter = cm[1].toUpperCase()
    const correctIndex = letters.indexOf(correctLetter)
    if (correctIndex < 0) continue

    const wcm = /^\s*WHY\s+CORRECT\s*:\s*(.+?)\s*$/im.exec(block)
    const whyCorrect = wcm ? wcm[1].trim() : ''

    const whyWrong = letters.map((L, i) => {
      if (i === correctIndex) return ''
      const wm = new RegExp(`^\\s*WHY\\s+${L}\\s*:\\s*(.+?)\\s*$`, 'im').exec(block)
      return wm ? wm[1].trim() : ''
    })

    out.push({ question, options, correctIndex, whyCorrect, whyWrong })
  }
  return out
}

/** Letter label for an option index (0→A, 1→B, …). */
export function optionLetter(i: number): string {
  return LETTERS[i] ?? String(i + 1)
}
