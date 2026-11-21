import { postcodeValidator, postcodeValidatorExistsForCountry } from "postcode-validator";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";

/**
 * Postal addresses (issue #533): an organisation's, checked where it's typed
 * and again by the API, without asking anyone outside. Countries are ISO
 * 3166-1 alpha-2 codes, named in the reader's language by `Intl`; a postal
 * code is checked against its country's format (postcode-validator, MIT).
 */
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
  "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
  "UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" ");

/** Whether `code` is a country we know. */
export function isCountryCode(code: string): boolean {
  return COUNTRY_CODES.includes(code);
}

/** Whether the country has postal codes whose format we know: then one is needed, and checked. */
export function countryHasPostalCodes(country: string): boolean {
  return isCountryCode(country) && postcodeValidatorExistsForCountry(country);
}

/** A postal code as written to be kept: spaces tidied, letters in capitals ("sw1a  1aa" → "SW1A 1AA"). */
export function tidyPostalCode(code: string): string {
  return code.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Whether a postal code fits its country: true for a country without a
 * format we know (nothing to check), false for an empty one where one's
 * needed.
 */
export function postalCodeFits(country: string, code: string): boolean {
  const tidy = tidyPostalCode(code);
  if (!countryHasPostalCodes(country)) return true;
  if (!tidy) return false;
  try {
    return postcodeValidator(tidy, country);
  } catch {
    return true;
  }
}

/** The countries, named in `locale` and sorted by that name, for a picker. */
export function countryOptions(locale: string): { code: string; name: string }[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale, "en"], { type: "region" });
  } catch {
    names = null;
  }
  return COUNTRY_CODES.map((code) => ({ code, name: names?.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** A country's name in `locale`, or its code. */
export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale, "en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** One line for an address: "12 rue de la Paix, 75002 Paris, France". */
export function addressLine(address: { street?: string | null; postalCode?: string | null; city?: string | null; country?: string | null }, locale: string): string {
  const town = [address.postalCode, address.city].filter(Boolean).join(" ");
  return [address.street, town, address.country ? countryName(address.country, locale) : null].filter(Boolean).join(", ");
}

/**
 * A phone number (issue #533), checked offline against its country's
 * numbering plan (libphonenumber-js, MIT): one written with its "+" and
 * country code, or one written as at home, read in `country` (the
 * address's). No SMS: it's only checked to be a number that can exist.
 */
export function readPhone(raw: string, country?: string | null): { e164: string; international: string } | null {
  const text = raw.trim();
  if (!text) return null;
  const region = country && isCountryCode(country) ? (country as CountryCode) : undefined;
  const phone = parsePhoneNumberFromString(text, region);
  if (!phone || !phone.isValid()) return null;
  return { e164: phone.number, international: phone.formatInternational() };
}

/** A phone number kept as E.164 ("+33612345678"), as people read it ("+33 6 12 34 56 78"). */
export function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}
