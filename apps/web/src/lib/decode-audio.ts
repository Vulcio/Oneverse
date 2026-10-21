/**
 * An audio file decoded for Web Audio (issue #185). The browser's own
 * decoder, always; but Safari before 18.4 (iOS, iPadOS, macOS - and every
 * iOS browser, all WebKit) can't read Ogg, and everything Songverse records,
 * separates or re-encodes is Opus in Ogg. It does read Opus in WebM, so
 * there the same packets are rewrapped as WebM (oggOpusToWebm, no decoding)
 * and given to it again. Only on WebKit: any other browser refusing a file
 * has the error as it is.
 */
import { oggOpusToWebm } from "@oneverse/core";

/** Ogg Opus: an Ogg page whose first packet is Opus's header. */
export function isOggOpus(bytes: Uint8Array): boolean {
  if (bytes.length < 36 || bytes[0] !== 0x4f || bytes[1] !== 0x67 || bytes[2] !== 0x67 || bytes[3] !== 0x53) return false;
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 200)));
  return head.includes("OpusHead");
}

/** "webm": rewrapped in any browser (the e2e suite, in Chromium). */
const FORCE_KEY = "songverse.audio.decoder";
/** The browser refused Ogg Opus once: it will again, so don't ask it twice. */
let nativeRefusesOgg = false;

function forced(): boolean {
  try {
    return localStorage.getItem(FORCE_KEY) === "webm";
  } catch {
    return false;
  }
}

/** Safari, or any iOS browser: WebKit, not Chrome's Blink (whose user agent says AppleWebKit too). */
function webKit(): boolean {
  if (typeof navigator === "undefined") return false;
  const agent = navigator.userAgent;
  return /AppleWebKit\//.test(agent) && !/Chrome\/|Chromium\/|Edg\//.test(agent);
}

/** Decodes `data`; Ogg Opus that Safari can't read, rewrapped as WebM first. */
export async function decodeAudio(context: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  const bytes = new Uint8Array(data);
  const rewrap = isOggOpus(bytes) && (forced() || webKit());
  if (!rewrap || (!nativeRefusesOgg && !forced())) {
    try {
      // decodeAudioData takes the buffer over: a copy, when it may still be rewrapped.
      return await context.decodeAudioData(rewrap ? data.slice(0) : data);
    } catch (error) {
      if (!rewrap) throw error;
      nativeRefusesOgg = true;
    }
  }
  const webm = oggOpusToWebm(bytes);
  if (!webm) throw new Error("Not an Opus file this browser can read");
  probe();
  return context.decodeAudioData(webm.buffer as ArrayBuffer);
}

/** For the end-to-end tests: how many files were rewrapped. */
function probe() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { songverseDecoder?: { rewrapped: number } };
  w.songverseDecoder ??= { rewrapped: 0 };
  w.songverseDecoder.rewrapped++;
}
