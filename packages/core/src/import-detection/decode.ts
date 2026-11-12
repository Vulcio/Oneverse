/**
 * A song file's bytes as text (issue #438): UTF-8 (with or without its
 * byte order mark), UTF-16 (as some apps export), or - when the bytes aren't
 * valid UTF-8 - Windows-1252, as older Windows files are ("é" stays "é").
 * Null for a file that isn't text at all (ProPresenter 7's `.pro`, an image).
 */
export function decodeSongFile(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return utf8(bytes.subarray(3));
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  // UTF-16 without its mark: ASCII letters with a zero byte beside each.
  const sample = bytes.subarray(0, 2000);
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] !== 0) continue;
    if (i % 2 === 0) evenZeros++;
    else oddZeros++;
  }
  const half = sample.length / 2;
  if (half >= 4 && oddZeros > half * 0.6 && evenZeros < half * 0.1) return new TextDecoder("utf-16le").decode(bytes);
  if (half >= 4 && evenZeros > half * 0.6 && oddZeros < half * 0.1) return new TextDecoder("utf-16be").decode(bytes);
  if (evenZeros + oddZeros > 0) return null;
  const text = utf8(bytes);
  // Control characters other than tabs and line ends: not a text file.
  let controls = 0;
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0b && code !== 0x0c && code !== 0x0d) controls++;
  }
  return controls > Math.max(2, text.length * 0.01) ? null : text;
}

function utf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
