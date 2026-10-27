/**
 * The "Move" transition (issue #324): words that are on both slides glide
 * from where they were to where they are now, growing or shrinking and
 * brightening or dimming on the way (a line moving up as the next one comes,
 * a repeated line, a chorus word in the same place); only what's new comes
 * in, and only what's gone fades out. Done with transforms on the words
 * already drawn, so a TV keeps up.
 *
 * Both slides are on the stage while it plays: the old one (`.sv-out`) over
 * the new. Words are matched in reading order, the longest run in common
 * (LCS), by their letters alone.
 */

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/** A word as it's matched: lower case, without punctuation. */
const norm = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/** The pairs (old index, new index) of the longest common run of `a` and `b`, in order. */
export function matchWords(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  // Lengths of the longest common runs of a[i..] and b[j..].
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) table[i]![j] = a[i] && a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  }
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] && a[i] === b[j]) pairs.push([i++, j++]);
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

/** How visible an element is through its groups (dimmed lines around the current ones), up to the slide. */
function opacityIn(element: Element, slide: Element): number {
  let opacity = 1;
  for (let at: Element | null = element.parentElement; at && at !== slide; at = at.parentElement) opacity *= Number(getComputedStyle(at).opacity) || 0;
  return opacity;
}

/**
 * Plays the Move from `out` (the old slide, just made `.sv-out`) to `into`
 * (the new one), over `duration` ms. Returns a function that stops it.
 */
export function moveWords(out: HTMLElement, into: HTMLElement, duration: number): () => void {
  const animations: Animation[] = [];
  const before = [...out.querySelectorAll<HTMLElement>("[data-word]")];
  const after = [...into.querySelectorAll<HTMLElement>("[data-word]")];
  // The stage may be drawn scaled (a preview): rects are on screen, transforms in the stage's own pixels.
  const zoom = into.getBoundingClientRect().width / Math.max(1, into.offsetWidth) || 1;
  const pairs = matchWords(
    before.map((word) => norm(word.textContent ?? "")),
    after.map((word) => norm(word.textContent ?? "")),
  );
  const moved = new Set<HTMLElement>();
  const gone = new Set(before);
  // Which way the words go, on average: what's left of the old slide goes the same way as it fades.
  let sumX = 0;
  let sumY = 0;
  for (const [i, j] of pairs) {
    const from = before[i]!;
    const to = after[j]!;
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    moved.add(to);
    gone.delete(from);
    // The old word is drawn by the new one now.
    from.style.visibility = "hidden";
    const scale = a.height / b.height;
    const dx = (a.left + a.width / 2 - (b.left + b.width / 2)) / zoom;
    const dy = (a.top + a.height / 2 - (b.top + b.height / 2)) / zoom;
    sumX -= dx;
    sumY -= dy;
    // A word that was dimmer or brighter than its new line: its own opacity takes it there, as far as it can.
    const was = opacityIn(from, out);
    const is = opacityIn(to, into) || 1;
    const start = Math.min(1, was / is);
    // A word revealed piece by piece is already there: no reveal for it.
    to.style.animation = "none";
    animations.push(
      to.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: start }, { transform: "none", opacity: 1 }], { duration, easing: EASE }),
    );
  }
  if (moved.size > 0) {
    const shift = `translate(${sumX / moved.size}px, ${sumY / moved.size}px)`;
    for (const word of gone) animations.push(word.animate([{ transform: "none" }, { transform: shift }], { duration: duration * 0.5, easing: EASE, fill: "forwards" }));
  }
  // A line that dims as it moves (the current one becoming the line before): its group fades down from as bright as it was.
  const brighter = new Map<HTMLElement, number[]>();
  for (const [i, j] of pairs) {
    const group = after[j]!.closest<HTMLElement>("[data-group]");
    if (group && group !== into) brighter.set(group, [...(brighter.get(group) ?? []), opacityIn(before[i]!, out)]);
  }
  for (const [group, was] of brighter) {
    const from = was.reduce((sum, one) => sum + one, 0) / was.length;
    const to = Number(getComputedStyle(group).opacity) || 0;
    if (from > to + 0.01) animations.push(group.animate([{ opacity: from }, { opacity: to }], { duration, easing: EASE }));
  }
  // What's new comes in once the old words have started moving; what's revealed piece by piece keeps its own way.
  for (const word of after) {
    if (moved.has(word) || word.classList.contains("sv-piece")) continue;
    animations.push(
      word.animate([{ opacity: 0, transform: "translateY(0.25em)" }, { opacity: 1, transform: "none" }], { duration: duration * 0.7, delay: duration * 0.3, easing: EASE, fill: "backwards" }),
    );
  }
  return () => {
    for (const animation of animations) animation.cancel();
    for (const word of before) word.style.visibility = "";
  };
}
