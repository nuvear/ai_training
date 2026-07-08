import 'server-only';
import path from 'node:path';
import { Font } from '@react-pdf/renderer';

// ─────────────────────────────────────────────────────────────────────────────
// Japanese-capable font for the bilingual PDFs. We bundle Noto Sans JP under
// assets/fonts/ and register it with @react-pdf's fontkit so JA glyphs render and
// the font subset is embedded in every PDF (no network at render time). The build
// verifies a rendered PDF starts with %PDF and contains an embedded FontFile.
// ─────────────────────────────────────────────────────────────────────────────

export const JP_FONT = 'NotoSansJP';

let registered = false;

/** Register the bundled JA font once per process (idempotent). */
export function ensureFonts(): void {
  if (registered) return;
  const src = path.join(process.cwd(), 'assets', 'fonts', 'NotoSansJP-Regular.ttf');
  Font.register({ family: JP_FONT, src });
  // Keep long JA/EN strings from breaking the layout at every character.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
