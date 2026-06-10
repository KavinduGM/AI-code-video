/**
 * Pull one or more YAML script bodies out of a markdown / text document.
 *
 * Strategy, in priority order:
 *   1. Fenced code blocks (```yaml / ```yml / plain ```) — most natural for .md.
 *   2. YAML doc separators — a line that is exactly `---` at column 0.
 *   3. Single script — the whole file as one chunk.
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
  if (separated.length > 0) return separated

  const single = text.trim()
  return single && looksLikeScript(single) ? [single] : []
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
