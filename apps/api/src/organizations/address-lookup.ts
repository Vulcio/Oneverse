import type { AddressSuggestion } from "@oneverse/core";
import { tidyPostalCode } from "@oneverse/core";
import { providerFetch } from "../metadata/provider-timeout.js";
import { getEffectiveOrganizationSettings } from "./organization-settings.js";

/**
 * Addresses for organisations (issue #533): suggested as they're typed, and
 * looked up once when a request is sent so the reviewer sees whether it
 * exists. France from the Base Adresse Nationale (free, no key, through IGN's
 * Géoplateforme), everywhere else from Photon (OpenStreetMap's data, komoot's
 * public server or one of your own). Off by default (Admin > Organisations);
 * it never blocks anything: an answer that doesn't come is no suggestion.
 */

/** The Géoplateforme's geocoder; BAN_URL only to point the tests elsewhere. */
const banUrl = () => (process.env.BAN_URL ?? "https://data.geopf.fr/geocodage").replace(/\/+$/, "");

const LIMIT = 5;
const CACHE_MS = 10 * 60_000;
const CACHE_SIZE = 500;
const cache = new Map<string, { at: number; value: AddressSuggestion[] }>();

interface Feature {
  properties?: Record<string, unknown>;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function fromBan(feature: Feature): AddressSuggestion | null {
  const p = feature.properties ?? {};
  const street = text(p.name);
  const city = text(p.city);
  if (!street || !city || !["housenumber", "street", "locality"].includes(text(p.type))) return null;
  return { label: text(p.label) || `${street} ${text(p.postcode)} ${city}`, street, postalCode: text(p.postcode), city, country: "FR", source: "ban" };
}

function fromPhoton(feature: Feature): AddressSuggestion | null {
  const p = feature.properties ?? {};
  const country = text(p.countrycode).toUpperCase();
  const road = text(p.street) || (p.type === "street" ? text(p.name) : "");
  const city = text(p.city) || text(p.town) || text(p.village) || text(p.district);
  if (!road || !city || !country) return null;
  const number = text(p.housenumber);
  // Most countries write the number first; these after the street.
  const after = ["DE", "AT", "CH", "NL", "BE", "IT", "ES", "PT", "PL", "CZ", "SK", "DK", "SE", "NO", "FI", "HU", "HR", "SI", "RO", "BR", "AR", "MX", "CL", "CO"].includes(country);
  const street = number ? (after ? `${road} ${number}` : `${number} ${road}`) : road;
  const postalCode = text(p.postcode);
  return { label: [street, [postalCode, city].filter(Boolean).join(" "), text(p.country)].filter(Boolean).join(", "), street, postalCode, city, country, source: "photon" };
}

/** The features found; null when the service didn't answer. */
async function ask(url: string): Promise<Feature[] | null> {
  try {
    const response = await providerFetch(url, { headers: { accept: "application/json", "user-agent": "Oneverse (organisation addresses)" } });
    if (!response.ok) return null;
    const body = (await response.json()) as { features?: unknown };
    return Array.isArray(body.features) ? (body.features as Feature[]) : null;
  } catch {
    return null;
  }
}

async function search(q: string, country: string | undefined, lang: string | undefined, settings: { photonUrl: string; addressLookupFrance: boolean }): Promise<AddressSuggestion[] | null> {
  const key = JSON.stringify([q.toLowerCase(), country, lang, settings]);
  const kept = cache.get(key);
  if (kept && Date.now() - kept.at < CACHE_MS) return kept.value;
  let value: AddressSuggestion[];
  if (country === "FR" && settings.addressLookupFrance) {
    const features = await ask(`${banUrl()}/search?${new URLSearchParams({ q, limit: String(LIMIT), autocomplete: "1", index: "address" })}`);
    if (!features) return null;
    value = features.map(fromBan).filter((s): s is AddressSuggestion => !!s);
  } else {
    // Photon can't be told a country: ask for more and keep the country's.
    const params = new URLSearchParams({ q, limit: String(country ? LIMIT * 3 : LIMIT) });
    if (lang && ["en", "fr", "de", "it"].includes(lang)) params.set("lang", lang);
    const features = await ask(`${settings.photonUrl}/api?${params}`);
    if (!features) return null;
    value = features
      .map(fromPhoton)
      .filter((s): s is AddressSuggestion => !!s && (!country || s.country === country))
      .slice(0, LIMIT);
  }
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Addresses like what's typed; none when the lookup is off, the text is short or the service doesn't answer. */
export async function suggestAddresses(q: string, country?: string, lang?: string): Promise<AddressSuggestion[]> {
  const query = q.trim().slice(0, 200);
  if (query.length < 3) return [];
  const settings = await getEffectiveOrganizationSettings();
  if (!settings.addressLookup) return [];
  return (await search(query, country?.toUpperCase(), lang, settings)) ?? [];
}

/**
 * Looks a request's address up (when it's sent): found, and as what, for
 * the reviewer; null when the lookup is off or didn't answer. Found means
 * the street (with its number when written) in that postal code or city.
 */
export async function checkAddress(address: { street?: string | null; postalCode?: string | null; city?: string | null; country?: string | null }): Promise<{ found: boolean; as: string | null } | null> {
  const settings = await getEffectiveOrganizationSettings();
  const street = address.street?.trim();
  const country = address.country?.toUpperCase();
  if (!settings.addressLookup || !street || !country) return null;
  const postalCode = address.postalCode ? tidyPostalCode(address.postalCode) : "";
  const city = address.city?.trim() ?? "";
  const q = [street, postalCode, city].filter(Boolean).join(" ");
  const results = await search(q, country, undefined, settings);
  // No answer at all is unknown; an answer with nothing like it is "not found".
  if (!results) return null;
  const number = street.match(/\d+/)?.[0];
  const match = results.find((s) => {
    // "33 000" is 33000.
    const samePlace = postalCode ? s.postalCode.replace(/\s/g, "").toUpperCase() === postalCode.replace(/\s/g, "") : fold(s.city) === fold(city);
    const sameNumber = !number || s.street.match(/\d+/)?.[0] === number;
    return samePlace && sameNumber;
  });
  return match ? { found: true, as: `${match.label} · ${match.source === "ban" ? "BAN" : "OpenStreetMap"}` } : { found: false, as: null };
}
