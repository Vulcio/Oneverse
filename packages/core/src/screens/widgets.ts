import type { ScreenWidget } from "./theme.js";

type QrOptions = ScreenWidget["options"]["qr"];

/** Text in a vCard or an iCalendar value: its backslashes, commas, semicolons and line breaks escaped. */
const escapeText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** Text in a Wi-Fi code: its backslashes, semicolons, commas, colons and quotes escaped. */
const escapeWifi = (value: string) => value.replace(/([\\;,:"])/g, "\\$1");
/** YYYY-MM-DDTHH:MM to an iCalendar local time (YYYYMMDDTHHMMSS), or null. */
const icalTime = (value: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value.replace(/[-:]/g, "")}00` : null);

/**
 * What a QR code widget encodes (issue #289): an address as it is, an event
 * as an iCalendar VEVENT, a contact as a vCard 3.0, a Wi-Fi network as the
 * WIFI: scheme phones read. Null when there's nothing to encode yet.
 */
export function screenQrPayload(qr: QrOptions): string | null {
  switch (qr.kind) {
    case "url": {
      const url = qr.url.trim();
      return url || null;
    }
    case "event": {
      const start = icalTime(qr.start);
      if (!qr.title.trim() || !start) return null;
      const end = icalTime(qr.end);
      return [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        `SUMMARY:${escapeText(qr.title.trim())}`,
        `DTSTART:${start}`,
        ...(end ? [`DTEND:${end}`] : []),
        ...(qr.place.trim() ? [`LOCATION:${escapeText(qr.place.trim())}`] : []),
        ...(qr.url.trim() ? [`URL:${qr.url.trim()}`] : []),
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");
    }
    case "contact": {
      const name = qr.name.trim();
      if (!name && !qr.phone.trim() && !qr.email.trim()) return null;
      return [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${escapeText(name)}`,
        `N:${escapeText(name)};;;;`,
        ...(qr.organization.trim() ? [`ORG:${escapeText(qr.organization.trim())}`] : []),
        ...(qr.phone.trim() ? [`TEL:${qr.phone.trim()}`] : []),
        ...(qr.email.trim() ? [`EMAIL:${qr.email.trim()}`] : []),
        ...(qr.url.trim() ? [`URL:${qr.url.trim()}`] : []),
        "END:VCARD",
      ].join("\r\n");
    }
    case "wifi": {
      if (!qr.ssid) return null;
      const password = qr.security === "nopass" ? "" : `P:${escapeWifi(qr.password)};`;
      return `WIFI:T:${qr.security};S:${escapeWifi(qr.ssid)};${password};`;
    }
  }
}

/**
 * Where the screens are (issue #289), for the Slide count widget: the slide
 * shown (from 1) out of the song's slides, or out of the whole set's - the
 * set's songs' slide counts in order, the song shown at `item`. Null when
 * nothing's shown.
 */
export function screenSlideCount(scope: "song" | "set", counts: number[], item: number, slide: number): { position: number; count: number } | null {
  if (item < 0 || item >= counts.length || slide < 0 || slide >= counts[item]!) return null;
  if (scope === "song") return { position: slide + 1, count: counts[item]! };
  const before = counts.slice(0, item).reduce((sum, one) => sum + one, 0);
  return { position: before + slide + 1, count: counts.reduce((sum, one) => sum + one, 0) };
}
