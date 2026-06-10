/**
 * Pull one or more YAML script bodies out of a markdown / text document.
 *
 * Strategy, in priority order:
 *   1. Fenced code blocks (```yaml / ```yml / plain ```) — most natural for .md.
 *   2. YAML doc separators — a line that is exactly `---` at column 0.
 *   3. `video_name:` boundaries — split wherever a NEW top-level `video_name:`
 *      key starts (column 0). This handles the common case of several scripts
 *      pasted back-to-back with only comment banners between them and no
 *      separators at all (which would otherwise fail as "Map keys must be
 *      unique" because video_name appears N times in one document).
 *   4. Single script — the whole file as one chunk.
 *
 * Each candidate chunk must contain a `video_name:` line to count as a script;
 * this filters out YAML front-matter, plain prose, and accidental empty code
 * blocks (e.g. a `bash` block someone left in the doc).
 */
export function extractScriptsFromDocument(text: string): string[] {
  const fenced = extractFencedBlocks(text).filter(looksLikeScript)
  if (fenced.length > 0) return fenced

  // Split only on `---` at column 0 — anything indented could be inside a YAML
  // literal block (description: |) where the user happens to have written `---`.
  const separated = text
    .split(/^---[ \t]*\r?$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter(looksLikeScript)
  if (separated.length > 1) return separated

  // No fences and no (multiple) `---` separators. If the document contains more
  // than one top-level `video_name:` key, it's several scripts concatenated —
  // split on those boundaries so each becomes its own parseable chunk.
  const byVideoName = splitOnTopLevelVideoName(text)
  if (byVideoName.length > 1) return byVideoName

  // Exactly one script (or one `---`-wrapped script): use whichever produced a
  // single clean chunk, else the whole trimmed file.
  if (separated.length === 1) return separated
  const single = text.trim()
  return single && looksLikeScript(single) ? [single] : []
}

/**
 * Split a document at every top-level (column-0) `video_name:` line. Everything
 * from one such line up to (but not including) the next becomes one chunk,
 * including any comment banner lines that sit between scripts — those are
 * harmless YAML comments and keep the surrounding context with the right script.
 * Leading content before the first `video_name:` (a title banner, etc.) is
 * discarded since it can't belong to any script.
 */
function splitOnTopLevelVideoName(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const startIdxs: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (/^video_name[ \t]*:/.test(lines[i])) startIdxs.push(i)
  }
  if (startIdxs.length <= 1) return startIdxs.length === 1 ? [text.trim()] : []

  const chunks: string[] = []
  for (let s = 0; s < startIdxs.length; s++) {
    const from = startIdxs[s]
    const to = s + 1 < startIdxs.length ? startIdxs[s + 1] : lines.length
    const chunk = lines.slice(from, to).join('\n').trim()
    if (chunk) chunks.push(chunk)
  }
  return chunks
}

function looksLikeScript(s: string): boolean {
  return /^[ \t]*video_name[ \t]*:/m.test(s)
}

function extractFencedBlocks(text: string): string[] {
  const blocks: string[] = []
  // Opening ``` (optional language tag) on its own line, content, closing ```.
  // We accept `yaml`, `yml`, or no language — but reject explicitly non-YAML
  // languages so a stray ```bash block doesn't get treated as a script.
  const re = /^```[ \t]*([A-Za-z0-9_+\-]*)[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const lang = (m[1] || '').toLowerCase()
    if (lang && lang !== 'yaml' && lang !== 'yml') continue
    blocks.push(m[2].trim())
  }
  return blocks
}

/**
 * Best-effort grab of the video_name from a chunk that may have failed to
 * parse — used only to label errors so the user knows which script in the
 * document went wrong without having to count by eye.
 */
export function sniffVideoName(chunk: string): string | undefined {
  const m = chunk.match(/^[ \t]*video_name[ \t]*:[ \t]*(.+)$/m)
  if (!m) return undefined
  return m[1].trim().replace(/^["']|["']$/g, '') || undefined
}
