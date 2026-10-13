/**
 * Placeholder tabs used only to exercise the pipeline end to end.
 *
 * These are ORIGINAL generic practice exercises (open-chord strumming and a C major
 * scale). They are NOT transcriptions of the songs they are attached to. Replace
 * them with tabs you have the rights to (`npm run import`).
 */

/** Open-chord strumming exercise: G, C, D, Em (a generic progression). */
export function chordExercise(label: string, tempo = 96): string {
  const G = "(3.6 2.5 0.4 0.3 0.2 3.1)";
  const C = "(3.5 2.4 0.3 1.2 0.1)";
  const D = "(0.4 2.3 3.2 2.1)";
  const Em = "(0.6 2.5 2.4 0.3 0.2 0.1)";
  const bar = (c: string) => `:8 ${c} ${c} ${c} ${c} ${c} ${c} ${c} ${c}`;
  const bars = [G, C, D, Em, G, C, D, G].map(bar).join(" |\n");
  return `\\title "${escape(label)}"
\\subtitle "Placeholder exercise - replace with a real tab"
\\tempo ${tempo}
.
\\track "Guitar"
\\staff {tabs}
${bars} |
`;
}

/** Two-octave-ish C major scale, up and down, in eighth notes. */
export function scaleExercise(label: string, tempo = 80): string {
  const up = "3.5 0.4 2.4 3.4 0.3 2.3 0.2 1.2";
  const down = "1.2 0.2 2.3 0.3 3.4 2.4 0.4 3.5";
  return `\\title "${escape(label)}"
\\subtitle "Placeholder exercise - replace with a real tab"
\\tempo ${tempo}
.
\\track "Guitar"
\\staff {tabs}
:8 ${up} | ${down} | ${up} | ${down} |
:4 (3.5 2.4 0.3 1.2 0.1) (3.5 2.4 0.3 1.2 0.1) :2 (3.5 2.4 0.3 1.2 0.1) |
`;
}

function escape(s: string): string {
  return s.replace(/\\/g, "").replace(/"/g, "'");
}
