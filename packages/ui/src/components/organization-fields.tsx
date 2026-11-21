import { Autocomplete } from "@base-ui/react/autocomplete";
import {
  ORGANIZATION_KINDS,
  ORGANIZATION_SIZES,
  countryHasPostalCodes,
  countryOptions,
  postalCodeFits,
  readPhone,
  type AddressSuggestion,
  type OrganizationKind,
  type OrganizationLookalike,
  type OrganizationSize,
} from "@oneverse/core";
import { MapPin } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FieldError } from "./field";
import { Input } from "./input";
import { Label } from "./label";
import { NativeSelect } from "./native-select";
import { Textarea } from "./textarea";

/** What's told about an organisation when asking for one (issues #364, #533). */
export interface OrganizationDraft {
  name: string;
  kind: OrganizationKind;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  responsibleFirstName: string;
  responsibleLastName: string;
  phone: string;
  website: string;
  peopleCount: OrganizationSize | "";
  description: string;
}

export function emptyOrganizationDraft(country = ""): OrganizationDraft {
  return { name: "", kind: "CHURCH", street: "", postalCode: "", city: "", country, responsibleFirstName: "", responsibleLastName: "", phone: "", website: "", peopleCount: "", description: "" };
}

/** The country a browser's language suggests ("fr-FR" → "FR"), or none. */
export function countryFromLocale(language: string | undefined): string {
  const region = language?.split("-")[1]?.toUpperCase();
  return region && /^[A-Z]{2}$/.test(region) ? region : "";
}

/** Whether the postal code needs fixing, for its country: null when it's fine (or not typed yet). */
export function postalCodeProblem(draft: OrganizationDraft): "needed" | "format" | null {
  if (!draft.country || !countryHasPostalCodes(draft.country)) return null;
  if (!draft.postalCode.trim()) return "needed";
  return postalCodeFits(draft.country, draft.postalCode) ? null : "format";
}

/** Whether the phone number needs fixing: null when it's a number that can exist (read in the address's country unless it has its own code), or not typed yet. */
export function phoneProblem(draft: OrganizationDraft): "needed" | "invalid" | null {
  if (!draft.phone.trim()) return "needed";
  return readPhone(draft.phone, draft.country) ? null : "invalid";
}

/** Everything needed is there, and the postal code fits its country. */
export function organizationDraftReady(draft: OrganizationDraft): boolean {
  return (
    draft.name.trim().length >= 2 &&
    draft.street.trim().length >= 3 &&
    draft.city.trim().length >= 2 &&
    !!draft.country &&
    postalCodeProblem(draft) === null &&
    draft.responsibleFirstName.trim().length >= 1 &&
    draft.responsibleLastName.trim().length >= 1 &&
    phoneProblem(draft) === null
  );
}

/** The draft as the API takes it: empty optional fields left out. */
export function organizationDraftBody(draft: OrganizationDraft) {
  return {
    name: draft.name,
    kind: draft.kind,
    street: draft.street,
    city: draft.city,
    country: draft.country,
    responsibleFirstName: draft.responsibleFirstName,
    responsibleLastName: draft.responsibleLastName,
    ...(draft.postalCode.trim() ? { postalCode: draft.postalCode } : {}),
    ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}),
    ...(draft.website.trim() ? { website: draft.website.trim() } : {}),
    ...(draft.peopleCount ? { peopleCount: draft.peopleCount } : {}),
    ...(draft.description.trim() ? { description: draft.description } : {}),
  };
}

interface OrganizationFieldsProps {
  value: OrganizationDraft;
  onChange: (next: OrganizationDraft) => void;
  /** Its ids' prefix, for two forms on a page. */
  idPrefix?: string;
  /** What the API found it looks like (a 409), shown with the note that sends it anyway. */
  looksLike?: OrganizationLookalike[] | null;
  duplicateNote?: string;
  onDuplicateNoteChange?: (note: string) => void;
  /** Addresses like what's typed in the street (the API's lookup, issue #533); none: no suggestions. */
  suggest?: (q: string, country: string) => Promise<AddressSuggestion[]>;
}

const SOURCES = { ban: "Base Adresse Nationale", photon: "OpenStreetMap" } as const;

/**
 * The street, with addresses suggested as it's typed (Base UI's
 * Autocomplete): picking one fills the postal code, city and country too.
 * Typed freely all the same - a suggestion is never required.
 */
function StreetInput({ id, value, onChange, suggest }: { id: string; value: OrganizationDraft; onChange: (next: OrganizationDraft) => void; suggest?: OrganizationFieldsProps["suggest"] }) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const asked = useRef(0);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!suggest || query.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const turn = ++asked.current;
    const timer = setTimeout(() => {
      suggest(query, value.country)
        .then((found) => {
          if (turn === asked.current) setSuggestions(found);
        })
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, value.country, suggest]);
  if (!suggest) return <Input id={id} value={value.street} maxLength={200} onChange={(event) => onChange({ ...value, street: event.target.value })} autoComplete="street-address" />;
  const source = suggestions[0]?.source;
  return (
    <Autocomplete.Root
      items={suggestions}
      mode="none"
      value={value.street}
      itemToStringValue={(item: AddressSuggestion) => item.label}
      onValueChange={(text, details) => {
        // Picked (clicked or Enter): the whole address; typed: the street.
        const picked = details.reason === "item-press" ? suggestions.find((one) => one.label === text) : undefined;
        if (picked) {
          onChange({ ...value, street: picked.street, postalCode: picked.postalCode || value.postalCode, city: picked.city, country: picked.country });
          setSuggestions([]);
          return;
        }
        onChange({ ...value, street: text });
        setQuery(text);
      }}
    >
      <Autocomplete.Input id={id} maxLength={200} autoComplete="off" render={<Input />} />
      {suggestions.length > 0 ? (
        <Autocomplete.Portal>
          <Autocomplete.Positioner sideOffset={4} className="isolate z-50 outline-none">
            <Autocomplete.Popup
              aria-label={t("organizations.address.suggestions")}
              data-testid="address-suggestions"
              className="max-h-[min(var(--available-height),20rem)] w-(--anchor-width) overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none"
            >
              <Autocomplete.List>
                {(item: AddressSuggestion) => (
                  <Autocomplete.Item
                    key={item.label}
                    value={item}
                    className="flex cursor-default items-start gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  >
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span>{item.label}</span>
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
              {source ? <p className="px-2 pt-1 pb-0.5 text-[11px] text-muted-foreground">{t("organizations.address.suggestionsFrom", { source: SOURCES[source] })}</p> : null}
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      ) : null}
    </Autocomplete.Root>
  );
}

/**
 * An organisation's details (issue #533): its name and what it is, its
 * address - the country picked from a list, the postal code checked against
 * the country's format as it's typed - and the person responsible. Used to
 * ask for one in the app (planning) and when signing up (Oneverse).
 */
export function OrganizationFields({ value, onChange, idPrefix = "organization", looksLike, duplicateNote = "", onDuplicateNoteChange, suggest }: OrganizationFieldsProps) {
  const { t, i18n } = useTranslation();
  const countries = useMemo(() => countryOptions(i18n.language || "en"), [i18n.language]);
  const set = <K extends keyof OrganizationDraft>(field: K) => (event: { target: { value: string } }) => onChange({ ...value, [field]: event.target.value as OrganizationDraft[K] });
  const id = (field: string) => `${idPrefix}-${field}`;
  const postal = postalCodeProblem(value);
  const phone = phoneProblem(value);
  // The phone is checked once it's left, not at its first digits.
  const [phoneLeft, setPhoneLeft] = useState(false);
  const phoneRead = phone === null ? readPhone(value.phone, value.country) : null;
  const same = looksLike?.filter((one) => one.match === "same") ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id("name")}>{t("organizations.name")}</Label>
        <Input id={id("name")} value={value.name} maxLength={100} onChange={set("name")} autoComplete="organization" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id("kind")}>{t("organizations.requests.kind")}</Label>
        <NativeSelect id={id("kind")} value={value.kind} onChange={set("kind")}>
          {ORGANIZATION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`organizations.kinds.${kind}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{t("organizations.address.title")}</legend>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("country")}>{t("organizations.address.country")}</Label>
          <NativeSelect id={id("country")} value={value.country} onChange={set("country")} autoComplete="country">
            <option value="">{t("organizations.address.chooseCountry")}</option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("street")}>{t("organizations.address.street")}</Label>
          <StreetInput id={id("street")} value={value} onChange={onChange} suggest={suggest} />
        </div>
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id("postal-code")}>{t("organizations.address.postalCode")}</Label>
            <Input id={id("postal-code")} value={value.postalCode} maxLength={20} onChange={set("postalCode")} autoComplete="postal-code" aria-invalid={postal === "format" && value.postalCode.trim() ? true : undefined} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id("city")}>{t("organizations.requests.city")}</Label>
            <Input id={id("city")} value={value.city} maxLength={100} onChange={set("city")} autoComplete="address-level2" />
          </div>
        </div>
        {postal === "format" && value.postalCode.trim() ? <FieldError data-testid="postal-code-problem">{t("organizations.address.postalCodeFormat")}</FieldError> : null}
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{t("organizations.address.responsible")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id("first-name")}>{t("organizations.address.firstName")}</Label>
            <Input id={id("first-name")} value={value.responsibleFirstName} maxLength={100} onChange={set("responsibleFirstName")} autoComplete="given-name" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id("last-name")}>{t("organizations.address.lastName")}</Label>
            <Input id={id("last-name")} value={value.responsibleLastName} maxLength={100} onChange={set("responsibleLastName")} autoComplete="family-name" />
          </div>
        </div>
        <span className="text-xs text-muted-foreground">{t("organizations.address.responsibleHint")}</span>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("phone")}>{t("organizations.address.phone")}</Label>
          <Input
            id={id("phone")}
            type="tel"
            inputMode="tel"
            value={value.phone}
            maxLength={40}
            onChange={set("phone")}
            onBlur={() => setPhoneLeft(true)}
            autoComplete="tel"
            aria-invalid={phone === "invalid" && phoneLeft ? true : undefined}
            aria-describedby={id("phone-hint")}
          />
          {phone === "invalid" && phoneLeft ? (
            <FieldError data-testid="phone-problem">{t("organizations.address.phoneProblem")}</FieldError>
          ) : phoneRead ? (
            <span className="text-xs text-muted-foreground" data-testid="phone-kept">
              {t("organizations.address.phoneKept", { number: phoneRead.international })}
            </span>
          ) : null}
          <span id={id("phone-hint")} className="text-xs text-muted-foreground">
            {t("organizations.address.phoneHint")}
          </span>
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("website")}>{t("organizations.requests.websiteOptional")}</Label>
          <Input id={id("website")} type="url" placeholder="https://" value={value.website} maxLength={300} onChange={set("website")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("size")}>{t("organizations.requests.size")}</Label>
          <NativeSelect id={id("size")} value={value.peopleCount} onChange={set("peopleCount")}>
            <option value="">-</option>
            {ORGANIZATION_SIZES.map((size) => (
              <option key={size} value={size}>
                {t(`organizations.sizes.${size}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id("description")}>{t("organizations.descriptionLabel")}</Label>
        <Textarea id={id("description")} value={value.description} maxLength={500} onChange={set("description")} />
      </div>
      {same.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md bg-destructive/10 p-3 text-sm" data-testid="request-already-here">
          <p className="font-medium">{t("organizations.address.alreadyHere")}</p>
          <ul className="list-disc pl-5 text-xs">
            {same.map((one) => (
              <li key={`${one.source}-${one.id}`}>
                {one.name}
                {one.city ? ` · ${one.city}` : ""} ({t(one.source === "organization" ? "organizations.requests.existing" : "organizations.requests.alsoAsked")})
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t("organizations.address.alreadyHereHint")}</p>
        </div>
      ) : looksLike && looksLike.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md bg-warning/10 p-3 text-sm" data-testid="request-looks-like">
          <p className="font-medium">{t("organizations.requests.looksLikeYours")}</p>
          <ul className="list-disc pl-5 text-xs">
            {looksLike.map((one) => (
              <li key={`${one.source}-${one.id}`}>
                {one.name}
                {one.city ? ` · ${one.city}` : ""} ({t(one.source === "organization" ? "organizations.requests.existing" : "organizations.requests.alsoAsked")})
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t("organizations.requests.looksLikeHint")}</p>
          <Label htmlFor={id("duplicate-note")}>{t("organizations.requests.duplicateNote")}</Label>
          <Textarea id={id("duplicate-note")} value={duplicateNote} maxLength={500} onChange={(event) => onDuplicateNoteChange?.(event.target.value)} />
        </div>
      ) : null}
    </div>
  );
}
