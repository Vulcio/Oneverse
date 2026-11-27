import { ApiError, formatPrice, placesCount, placesFit, priceOf, type ApiClient, type MyRegistration, type PlaceKind, type Places, type PublicRegistrationPage, type RegistrationAnswers, type RegistrationQuestion } from "@oneverse/core";
import { CalendarDays, MapPin, Minus, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { FieldError } from "@oneverse/ui/components/field";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Textarea } from "@oneverse/ui/components/textarea";

/**
 * The public pages of registration for event dates (issue #593), in the
 * Oneverse app (and Songverse's when Oneverse isn't deployed): the page
 * anyone with its link registers on, signed in or not, and the page the
 * link in a registration's emails opens, to see, change or cancel it.
 */

type PageDate = PublicRegistrationPage["dates"][number];

/** "Fri 12 June, 19:00 – Sun 14 June, 16:00", or one day's times. */
function useWhen(timeZone: string) {
  const { i18n } = useTranslation();
  const dayAndTime = new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone });
  const timeOnly = new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit", timeZone });
  const dayOnly = new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "numeric", year: "numeric", timeZone });
  return (date: Pick<PageDate, "startsAt" | "endsAt">) => {
    const start = new Date(date.startsAt);
    const end = new Date(date.endsAt);
    const sameDay = dayOnly.format(start) === dayOnly.format(end);
    return `${dayAndTime.format(start)} – ${(sameDay ? timeOnly : dayAndTime).format(end)}`;
  };
}

/** What a date says about its places: open, full, opening later. */
function DateState({ date, waitingList, timeZone }: { date: PageDate; waitingList: boolean; timeZone: string }) {
  const { t, i18n } = useTranslation();
  if (date.state === "closed") return <Badge variant="outline">{t("registrations.stateClosed")}</Badge>;
  if (date.state === "notYet") {
    const when = new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(date.opensAt!));
    return <Badge variant="outline">{t("registrations.stateNotYet", { when })}</Badge>;
  }
  if (date.left.total === 0) return <Badge variant="outline">{waitingList ? t("registrations.fullWaiting") : t("registrations.full")}</Badge>;
  if (date.left.total !== null) return <Badge variant="muted">{t("registrations.placesLeft", { count: date.left.total })}</Badge>;
  return null;
}

function EventHead({ page, children }: { page: Omit<PublicRegistrationPage, "dates">; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold" data-testid="registration-title">
        {page.title}
      </h1>
      <p className="text-sm text-muted-foreground">{t("registrations.by", { organizer: page.organizer })}</p>
      {children}
      {page.place ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-4 shrink-0" aria-hidden />
          {page.place}
        </p>
      ) : null}
      {page.intro ? <p className="text-sm whitespace-pre-line">{page.intro}</p> : null}
    </div>
  );
}

/** The places asked for, one stepper per kind, with its price and what's left. */
function PlacesField({ kinds, currency, places, left, onChange }: { kinds: PlaceKind[]; currency: string | null; places: Places; left: Record<string, number | null> | null; onChange: (places: Places) => void }) {
  const { t, i18n } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-2" data-testid="registration-places">
      <legend className="mb-1 text-sm font-medium">{t("registrations.places")}</legend>
      {kinds.map((kind) => {
        const count = places[kind.id] ?? 0;
        const kindLeft = left?.[kind.id];
        const set = (value: number) => onChange({ ...places, [kind.id]: Math.max(0, Math.min(50, value)) });
        return (
          <div key={kind.id} className="flex items-center gap-3" data-testid="registration-kind" data-kind={kind.name}>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">{kind.name}</span>
              <span className="text-xs text-muted-foreground">
                {kind.price === null ? t("registrations.free") : formatPrice(kind.price, currency, i18n.language)}
                {kindLeft !== null && kindLeft !== undefined ? ` · ${t("registrations.kindLeft", { count: kindLeft })}` : ""}
              </span>
            </div>
            <Button type="button" variant="outline" size="icon" disabled={count === 0} onClick={() => set(count - 1)} aria-label={t("registrations.less", { kind: kind.name })}>
              <Minus className="size-4" />
            </Button>
            <span className="w-6 text-center tabular-nums" data-testid="registration-count">
              {count}
            </span>
            <Button type="button" variant="outline" size="icon" onClick={() => set(count + 1)} aria-label={t("registrations.more", { kind: kind.name })} data-testid="registration-more">
              <Plus className="size-4" />
            </Button>
          </div>
        );
      })}
    </fieldset>
  );
}

function QuestionsField({ questions, answers, onChange }: { questions: RegistrationQuestion[]; answers: RegistrationAnswers; onChange: (answers: RegistrationAnswers) => void }) {
  const { t } = useTranslation();
  if (questions.length === 0) return null;
  const set = (id: string, value: string | number | boolean | undefined) => {
    const next = { ...answers };
    if (value === undefined || value === "") delete next[id];
    else next[id] = value;
    onChange(next);
  };
  return (
    <fieldset className="flex flex-col gap-3" data-testid="registration-questions">
      <legend className="mb-1 text-sm font-medium">{t("registrations.questions")}</legend>
      {questions.map((question) => {
        const id = `question-${question.id}`;
        const label = (
          <Label htmlFor={id}>
            {question.label}
            {question.required && question.type !== "yesno" ? <span className="text-muted-foreground"> ({t("registrations.required")})</span> : null}
          </Label>
        );
        const value = answers[question.id];
        if (question.type === "yesno") {
          return (
            <label key={question.id} className="flex items-center gap-2 text-sm">
              <input id={id} type="checkbox" className="size-4" checked={value === true} onChange={(event) => set(question.id, event.target.checked)} />
              {question.label}
            </label>
          );
        }
        return (
          <div key={question.id} className="flex flex-col gap-1.5">
            {label}
            {question.type === "choice" ? (
              <NativeSelect id={id} value={typeof value === "string" ? value : ""} required={question.required} onChange={(event) => set(question.id, event.target.value)}>
                <option value="">{t("registrations.choose")}</option>
                {(question.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </NativeSelect>
            ) : question.type === "number" ? (
              <Input id={id} type="number" value={typeof value === "number" ? String(value) : ""} required={question.required} onChange={(event) => set(question.id, event.target.value === "" ? undefined : Number(event.target.value))} />
            ) : (
              <Textarea id={id} rows={2} maxLength={2000} value={typeof value === "string" ? value : ""} required={question.required} onChange={(event) => set(question.id, event.target.value)} />
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

/** Answers kept for the questions, a yes/no left unticked sent as no. */
function answersToSend(questions: RegistrationQuestion[], answers: RegistrationAnswers): RegistrationAnswers {
  const sent: RegistrationAnswers = {};
  for (const question of questions) {
    const value = answers[question.id];
    if (question.type === "yesno") sent[question.id] = value === true;
    else if (value !== undefined && value !== "") sent[question.id] = value;
  }
  return sent;
}

function useErrorText() {
  const { t } = useTranslation();
  return (err: unknown) => {
    if (err instanceof ApiError && err.code === "REGISTRATION_FULL") return t("registrations.errorFull");
    if (err instanceof ApiError && err.code === "REGISTRATION_CLOSED") return t("registrations.errorClosed");
    if (err instanceof ApiError && err.code === "REGISTRATION_NOT_OPEN_YET") return t("registrations.errorNotYet");
    return err instanceof Error ? err.message : String(err);
  };
}

function Total({ kinds, currency, places }: { kinds: PlaceKind[]; currency: string | null; places: Places }) {
  const { t, i18n } = useTranslation();
  const price = priceOf(kinds, places);
  if (price === null) return null;
  return (
    <div className="flex flex-col gap-0.5" data-testid="registration-total">
      <p className="flex justify-between text-sm font-medium">
        <span>{t("registrations.total")}</span>
        <span>{formatPrice(price, currency, i18n.language)}</span>
      </p>
      <p className="text-xs text-muted-foreground">{t("registrations.totalHint")}</p>
    </div>
  );
}

/**
 * /register/:publicId: the event, its dates, and the form. Signed in, the
 * name and email come from the account and the registration is tied to it.
 * Registered, the page goes to the registration's own page.
 */
export function RegisterPage({ page, api, signedIn, onRegistered }: { page: PublicRegistrationPage | null; api: ApiClient; signedIn: { name: string; email: string; locale: string } | null; onRegistered: (registration: MyRegistration) => void }) {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const firstOpen = page?.dates.find((date) => date.state === "open") ?? page?.dates[0];
  const [day, setDay] = useState(firstOpen?.date ?? "");
  const [places, setPlaces] = useState<Places>(() => (page && page.placeKinds.length === 1 ? { [page.placeKinds[0]!.id]: 1 } : {}));
  const [answers, setAnswers] = useState<RegistrationAnswers>({});
  const [name, setName] = useState(signedIn?.name ?? "");
  const [email, setEmail] = useState(signedIn?.email ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = useWhen(page?.timeZone ?? "UTC");

  if (!page) return <p className="max-w-md text-center text-sm text-muted-foreground" data-testid="registration-not-found">{t("registrations.notFound")}</p>;
  const date = page.dates.find((one) => one.date === day) ?? null;
  const willWait = !!date && placesCount(places) > 0 && !placesFit({ limit: date.left.total, placeKinds: page.placeKinds.map((kind) => ({ ...kind, limit: date.left.byKind[kind.id] ?? null })) }, { total: 0, byKind: {} }, places);

  const submit = async () => {
    if (!date) return;
    setPending(true);
    setError(null);
    try {
      const kept = Object.fromEntries(Object.entries(places).filter(([, count]) => count > 0));
      onRegistered(await api.register(page.publicId, date.date, { name, email, places: kept, answers: answersToSend(page.questions, answers), locale: (signedIn?.locale ?? i18n.language) === "fr" ? "fr" : "en" }, !!signedIn));
    } catch (err) {
      setError(errorText(err));
      setPending(false);
    }
  };

  return (
    <Card className="w-full max-w-lg" data-testid="registration-page">
      <CardHeader>
        <EventHead page={page} />
      </CardHeader>
      <CardContent>
        {page.dates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("registrations.noDates")}</p>
        ) : (
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{t("registrations.pickDate")}</legend>
              {page.dates.map((one) => (
                <label key={one.date} className="flex items-center gap-3 rounded-md border p-2.5 text-sm has-[:checked]:border-primary" data-testid="registration-date" data-date={one.date}>
                  <input type="radio" name="registration-date" className="size-4" checked={day === one.date} disabled={one.state !== "open"} onChange={() => setDay(one.date)} />
                  <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">{when(one)}</span>
                  <DateState date={one} waitingList={page.waitingList} timeZone={page.timeZone} />
                </label>
              ))}
            </fieldset>
            {date?.state === "open" ? (
              <>
                <PlacesField kinds={page.placeKinds} currency={page.currency} places={places} left={date.left.byKind} onChange={setPlaces} />
                <QuestionsField questions={page.questions} answers={answers} onChange={setAnswers} />
                <fieldset className="flex flex-col gap-3">
                  <legend className="mb-1 text-sm font-medium">{t("registrations.you")}</legend>
                  {signedIn ? <p className="text-xs text-muted-foreground">{t("registrations.signedInAs", { name: signedIn.name })}</p> : null}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="registration-name">{t("registrations.name")}</Label>
                    <Input id="registration-name" required maxLength={120} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} data-testid="registration-name" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="registration-email">{t("registrations.email")}</Label>
                    <Input id="registration-email" type="email" required autoComplete="email" value={email} readOnly={!!signedIn} onChange={(event) => setEmail(event.target.value)} data-testid="registration-email" />
                    <span className="text-xs text-muted-foreground">{t("registrations.emailHint")}</span>
                  </div>
                </fieldset>
                <Total kinds={page.placeKinds} currency={page.currency} places={places} />
                {willWait && page.waitingList ? <p className="text-sm text-muted-foreground">{t("registrations.waitingHint")}</p> : null}
                {error ? <FieldError>{error}</FieldError> : null}
                <Button type="submit" disabled={pending || placesCount(places) === 0 || (willWait && !page.waitingList)} data-testid="registration-submit">
                  {pending ? t("registrations.registering") : willWait ? t("registrations.joinWaitingList") : t("registrations.register")}
                </Button>
              </>
            ) : null}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * /registration/:token: someone's registration, from the link in its
 * emails - its state, places and answers, changed while its date's
 * registration is open, and cancelled until the date starts.
 */
export function MyRegistrationPage({ token, initial, api, registerHref }: { token: string; initial: MyRegistration | null; api: ApiClient; registerHref: (publicId: string) => string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [registration, setRegistration] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [places, setPlaces] = useState<Places>(initial?.places ?? {});
  const [answers, setAnswers] = useState<RegistrationAnswers>(initial?.answers ?? {});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = useWhen(initial?.page.timeZone ?? "UTC");
  const { i18n } = useTranslation();

  if (!registration) return <p className="max-w-md text-center text-sm text-muted-foreground" data-testid="registration-not-found">{t("registrations.notFound")}</p>;
  const page = registration.page;
  const act = async (work: () => Promise<MyRegistration>) => {
    setPending(true);
    setError(null);
    try {
      const next = await work();
      setRegistration(next);
      setPlaces(next.places);
      setAnswers(next.answers);
      setEditing(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  };
  const status = registration.status;
  const kinds = page.placeKinds.filter((kind) => (registration.places[kind.id] ?? 0) > 0);

  return (
    <Card className="w-full max-w-lg" data-testid="my-registration" data-status={status}>
      <CardHeader>
        <EventHead page={page}>
          {page.date ? (
            <p className="flex items-center gap-1.5 text-sm">
              <CalendarDays className="size-4 shrink-0" aria-hidden />
              {when(page.date)}
            </p>
          ) : null}
        </EventHead>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-1 rounded-md border p-3" data-testid="my-registration-status">
          <CardTitle className="flex flex-wrap items-center gap-2">
            {status === "CONFIRMED" ? t("registrations.confirmed") : status === "WAITING" ? t("registrations.waiting") : t("registrations.cancelled")}
            {registration.paid ? <Badge>{t("registrations.paid")}</Badge> : null}
          </CardTitle>
          {status === "CONFIRMED" ? <p className="text-sm text-muted-foreground">{t("registrations.confirmedHint")}</p> : null}
          {status === "WAITING" ? <p className="text-sm text-muted-foreground">{t("registrations.waitingHint2")}</p> : null}
        </div>

        {editing ? (
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void act(() => api.updateMyRegistration(token, { places: Object.fromEntries(Object.entries(places).filter(([, count]) => count > 0)), answers: answersToSend(page.questions, answers) }));
            }}
          >
            <PlacesField kinds={page.placeKinds} currency={page.currency} places={places} left={null} onChange={setPlaces} />
            <QuestionsField questions={page.questions} answers={answers} onChange={setAnswers} />
            <Total kinds={page.placeKinds} currency={page.currency} places={places} />
            {error ? <FieldError>{error}</FieldError> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending || placesCount(places) === 0} data-testid="my-registration-save">
                {pending ? t("registrations.saving") : t("registrations.save")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                {t("registrations.cancelEdit")}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">{t("registrations.yourPlaces")}</p>
              <ul className="text-sm" data-testid="my-registration-places">
                {kinds.map((kind) => (
                  <li key={kind.id}>
                    {registration.places[kind.id]} × {kind.name}
                  </li>
                ))}
              </ul>
              {registration.price !== null ? (
                <p className="text-sm">
                  {t("registrations.total")}: {formatPrice(registration.price, page.currency, i18n.language)}
                </p>
              ) : null}
            </div>
            {page.questions.length ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium">{t("registrations.yourAnswers")}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  {page.questions.map((question) => {
                    const value = registration.answers[question.id];
                    return (
                      <div key={question.id} className="contents">
                        <dt className="text-muted-foreground">{question.label}</dt>
                        <dd>{typeof value === "boolean" ? (value ? t("registrations.yes") : t("registrations.no")) : (value ?? "–")}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            ) : null}
            {error ? <FieldError>{error}</FieldError> : null}
            {status !== "CANCELLED" ? (
              <div className="flex flex-wrap items-center gap-2">
                {registration.canChange ? (
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="my-registration-change">
                    {t("registrations.change")}
                  </Button>
                ) : null}
                <ConfirmButton label={t("registrations.cancel")} confirmLabel={t("registrations.cancelConfirm")} busyLabel={t("registrations.cancelling")} cancelLabel={t("registrations.keep")} busy={pending} onConfirm={() => act(() => api.cancelMyRegistration(token))} />
              </div>
            ) : (
              <Button variant="outline" size="sm" className="self-start" render={<a href={registerHref(page.publicId)} />}>
                {t("registrations.registerAgain")}
              </Button>
            )}
            {status !== "CANCELLED" && !registration.canChange ? <p className="text-xs text-muted-foreground">{t("registrations.closedHint")}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
