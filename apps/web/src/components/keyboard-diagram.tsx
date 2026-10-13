import { formatChord, parseChord, type ChordNotationValue, type PianoVoicing } from "@songverse/core";
import { useTranslation } from "react-i18next";
import { cn } from "@songverse/ui/lib/utils";

/**
 * A piano voicing drawn (issue #207 phase 4, docs/chord-diagrams.md): the
 * keyboard from just below its lowest key to just above its highest, the
 * right hand's keys marked with filled dots, the left hand's bass with a
 * ring, and the keys' names under them when asked for.
 */

const WHITE_WIDTH = 10;
const WHITE_HEIGHT = 40;
const BLACK_WIDTH = 6;
const BLACK_HEIGHT = 25;
const NAMES_ROOM = 9;
/** Semitones within an octave that are white keys, and each one's index among the seven. */
const WHITE_INDEX: Record<number, number> = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const isWhite = (note: number) => (note % 12) in WHITE_INDEX;
/** A white key's place along the keyboard. */
const whiteSlot = (note: number) => Math.floor(note / 12) * 7 + WHITE_INDEX[note % 12]!;

export function KeyboardDiagram({
  voicing,
  chord,
  name,
  notation,
  names,
  className,
}: {
  voicing: Pick<PianoVoicing, "left" | "right">;
  /** The chord, to spell the keys' names with sharps or flats as it does. */
  chord: string;
  name: string;
  notation: ChordNotationValue;
  /** The keys' names under them. */
  names: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const all = [...voicing.left, ...voicing.right];
  const lowest = Math.min(...all);
  const highest = Math.max(...all);
  // One white key's room either side.
  let from = lowest - 1;
  while (!isWhite(from)) from -= 1;
  let to = highest + 1;
  while (!isWhite(to)) to += 1;
  const first = whiteSlot(from);
  const whites: number[] = [];
  const blacks: number[] = [];
  for (let note = from; note <= to; note++) (isWhite(note) ? whites : blacks).push(note);
  const width = whites.length * WHITE_WIDTH;
  const height = WHITE_HEIGHT + (names ? NAMES_ROOM : 0) + 1;
  const x = (note: number) =>
    isWhite(note) ? (whiteSlot(note) - first) * WHITE_WIDTH + WHITE_WIDTH / 2 : (whiteSlot(note - 1) - first + 1) * WHITE_WIDTH;
  const parsed = parseChord(chord);
  const flats = parsed?.kind === "chord" && (parsed.root.accidental === "flat" || parsed.bass?.accidental === "flat");
  const keyName = (note: number) => {
    const letters = (flats ? FLATS : SHARPS)[note % 12]!;
    return notation === "SOLFEGE" ? formatChord(letters, "solfege") : letters;
  };
  const left = new Set(voicing.left);
  const right = new Set(voicing.right);
  return (
    <svg
      viewBox={`-0.5 -0.5 ${width + 1} ${height}`}
      role="img"
      aria-label={t("chords.keysLabel", { chord: name, keys: all.map(keyName).join(" ") })}
      className={cn("text-foreground", className)}
      data-keys={all.join(".")}
    >
      {whites.map((note) => (
        <rect
          key={`w${note}`}
          x={(whiteSlot(note) - first) * WHITE_WIDTH}
          y={0}
          width={WHITE_WIDTH}
          height={WHITE_HEIGHT}
          rx={1}
          fill="var(--color-background)"
          stroke="currentColor"
          strokeOpacity={0.55}
          strokeWidth={0.75}
        />
      ))}
      {blacks.map((note) => (
        <rect key={`b${note}`} x={x(note) - BLACK_WIDTH / 2} y={0} width={BLACK_WIDTH} height={BLACK_HEIGHT} rx={1} fill="currentColor" />
      ))}
      {all.map((note) => {
        const cy = isWhite(note) ? WHITE_HEIGHT - 7 : BLACK_HEIGHT - 6;
        // The right hand's keys a filled dot; the left hand's bass a ring (both, when it's in both hands).
        return (
          <g key={`k${note}`}>
            {right.has(note) ? <circle cx={x(note)} cy={cy} r={3} className="fill-primary" /> : null}
            {left.has(note) ? <circle cx={x(note)} cy={cy} r={3} fill="none" strokeWidth={1.4} className="stroke-amber-500" /> : null}
          </g>
        );
      })}
      {names
        ? all.map((note) => (
            <text key={`n${note}`} x={x(note)} y={WHITE_HEIGHT + NAMES_ROOM - 1.5} fontSize={6.5} textAnchor="middle" fill="currentColor">
              {keyName(note)}
            </text>
          ))
        : null}
    </svg>
  );
}
