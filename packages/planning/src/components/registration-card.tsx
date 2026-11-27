import { formatPrice, QUESTION_TYPES, type EventRegistration, type QuestionType, type RegistrationForm, type RegistrationFormRequest, type RegistrationList } from "@oneverse/core";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { FieldError } from "@oneverse/ui/components/field";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { ShareButton } from "@oneverse/ui/components/share-button";
import { Textarea } from "@oneverse/ui/components/textarea";
import { usePlanning } from "../host";

/**
 * Registration on an event date's page (issue #593). Those who manage it
 * (the event's admins, its organiser, the Manage registrations right) turn
 * it on and set it up, and see the date's registrations: places taken and
 * left, who waits, marking paid, cancelling, the CSV. Members see the link to
 * share. A group's part of an organisation's event shows the organisation's.
 */
export function RegistrationCard({ teamEventId, date, title }: { teamEventId: string; date: string; title: string }) {
  const { api } = usePlanning();
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<(EventRegistration & { organizationEventId?: string | null }) | null>(null);
  const [list, setList] = useState<RegistrationList | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const found = (await api.getEventRegistration({ teamEventId })) as EventRegistration & { organizationEventId?: string | null };
    setState(found);
    setList(found.form && found.canManage ? await api.listRegistrations(found.form.id, date) : null);
  }, [teamEventId, date]);
  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!state || (!state.form && !state.canManage)) return error ? <FieldError>{error}</FieldError> : null;
  const form = state.form;
  const target = state.organizationEventId ? { organizationEventId: state.organizationEventId } : { teamEventId };
  const kinds = form?.placeKinds ?? [];
  const money = (cents: number | null) => (cents === null ? null : formatPrice(cents, form?.currency ?? null, i18n.language));
  const summary = list?.date;

  return (
    <Card data-testid="registration-card">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          {t("registrations.cardTitle")}
          {form && !form.open ? <Badge variant="outline">{t("registrations.off")}</Badge> : null}
        </CardTitle>
        {state.canManage ? (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="registration-settings">
            {form ? t("registrations.settings") : t("registrations.setUp")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!form ? (
          <p className="text-sm text-muted-foreground">{t("registrations.setUpHint")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <a href={form.publicUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate text-sm text-primary hover:underline" data-testid="registration-link">
                {form.publicUrl}
              </a>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void navigator.clipboard.writeText(form.publicUrl).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  })
                }
              >
                {copied ? t("registrations.copied") : t("registrations.copyLink")}
              </Button>
              <ShareButton size="sm" link={{ title, url: form.publicUrl }} label={t("registrations.share")} />
            </div>
            {summary ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="registration-summary">
                <span>{t("registrations.taken", { count: summary.taken.total })}</span>
                {summary.left.total !== null ? <span>{t("registrations.left", { count: summary.left.total })}</span> : null}
                {kinds.map((kind) => (
                  <span key={kind.id} className="text-muted-foreground">
                    {kind.name}: {summary.taken.byKind[kind.id] ?? 0}
                    {kind.limit !== null ? ` / ${kind.limit}` : ""}
                  </span>
                ))}
                {summary.waiting ? <span>{t("registrations.waitingCount", { count: summary.waiting })}</span> : null}
              </div>
            ) : null}
            {list ? (
              list.registrations.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("registrations.nobody")}</p>
              ) : (
                <>
                  <ul className="flex flex-col divide-y text-sm" data-testid="registration-list">
                    {list.registrations.map((one) => (
                      <li key={one.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid="registration-row" data-status={one.status}>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className={one.status === "CANCELLED" ? "font-medium line-through" : "font-medium"}>{one.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {one.email} · {kinds.filter((kind) => (one.places[kind.id] ?? 0) > 0).map((kind) => `${one.places[kind.id]} × ${kind.name}`).join(", ")}
                            {one.price !== null ? ` · ${money(one.price)}` : ""}
                          </span>
                          {form.questions.some((question) => one.answers[question.id] !== undefined) ? (
                            <span className="text-xs text-muted-foreground">
                              {form.questions
                                .filter((question) => one.answers[question.id] !== undefined)
                                .map((question) => {
                                  const value = one.answers[question.id];
                                  return `${question.label}: ${typeof value === "boolean" ? (value ? t("registrations.yes") : t("registrations.no")) : value}`;
                                })
                                .join(" · ")}
                            </span>
                          ) : null}
                        </div>
                        {one.status === "WAITING" ? <Badge variant="outline">{t("registrations.waitingBadge")}</Badge> : null}
                        {one.status === "CANCELLED" ? <Badge variant="muted">{t("registrations.cancelledBadge")}</Badge> : null}
                        {one.status !== "CANCELLED" && one.price !== null ? (
                          <label className="flex items-center gap-1.5 text-xs">
                            <input type="checkbox" className="size-4" checked={one.paid} onChange={(event) => void act(() => api.manageRegistration(one.id, { paid: event.target.checked }))} data-testid="registration-paid" />
                            {t("registrations.paid")}
                          </label>
                        ) : null}
                        {one.status !== "CANCELLED" ? (
                          <ConfirmButton label={t("registrations.cancelOne")} confirmLabel={t("registrations.cancelConfirm")} busyLabel={t("registrations.cancelling")} cancelLabel={t("registrations.keep")} onConfirm={() => act(() => api.manageRegistration(one.id, { cancelled: true }))} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    data-testid="registration-export"
                    onClick={() =>
                      void act(async () => {
                        const blob = await api.exportRegistrations(form.id, date);
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = `${title} ${date}.csv`.replace(/[\\/:*?"<>|]/g, "-");
                        link.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      })
                    }
                  >
                    {t("registrations.export")}
                  </Button>
                </>
              )
            ) : null}
          </>
        )}
        {error ? <FieldError>{error}</FieldError> : null}
      </CardContent>
      {editing ? (
        <RegistrationSettingsDialog
          form={form}
          onClose={() => setEditing(false)}
          onSave={async (data) => {
            await api.saveEventRegistration({ ...target, ...data });
            setEditing(false);
            await load();
          }}
          onRemove={
            form
              ? async () => {
                  await api.removeEventRegistration(form.id);
                  setEditing(false);
                  await load();
                }
              : null
          }
        />
      ) : null}
    </Card>
  );
}

type KindDraft = { id?: string; name: string; limit: string; price: string };
type QuestionDraft = { id?: string; label: string; type: QuestionType; options: string; required: boolean };

const cents = (value: string): number | null => (value.trim() === "" ? null : Math.round(Number(value.replace(",", ".")) * 100));
const amount = (value: number | null) => (value === null ? "" : (value / 100).toFixed(2));
const whole = (value: string): number | null => (value.trim() === "" ? null : Number(value));

/** An event's registration settings: when it opens and closes, its places, its questions, its waiting list. */
function RegistrationSettingsDialog({ form, onClose, onSave, onRemove }: { form: RegistrationForm | null; onClose: () => void; onSave: (data: Omit<RegistrationFormRequest, "teamEventId" | "organizationEventId">) => Promise<void>; onRemove: (() => Promise<void>) | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(form?.open ?? true);
  const [limit, setLimit] = useState(form?.limit?.toString() ?? "");
  const [kinds, setKinds] = useState<KindDraft[]>(form?.placeKinds.map((kind) => ({ id: kind.id, name: kind.name, limit: kind.limit?.toString() ?? "", price: amount(kind.price) })) ?? [{ name: t("registrations.defaultKind"), limit: "", price: "" }]);
  const [currency, setCurrency] = useState(form?.currency ?? "EUR");
  const [questions, setQuestions] = useState<QuestionDraft[]>(form?.questions.map((question) => ({ id: question.id, label: question.label, type: question.type, options: (question.options ?? []).join(", "), required: question.required })) ?? []);
  const [waitingList, setWaitingList] = useState(form?.waitingList ?? true);
  const [opensDaysBefore, setOpensDaysBefore] = useState(form?.opensDaysBefore?.toString() ?? "");
  const [closesHoursBefore, setClosesHoursBefore] = useState(form?.closesHoursBefore?.toString() ?? "0");
  const [intro, setIntro] = useState(form?.intro ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const priced = kinds.some((kind) => kind.price.trim() !== "");

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await onSave({
        open,
        limit: whole(limit),
        placeKinds: kinds.map((kind) => ({ ...(kind.id && { id: kind.id }), name: kind.name, limit: whole(kind.limit), price: cents(kind.price) })),
        currency: priced ? currency : null,
        questions: questions.map((question) => ({
          ...(question.id && { id: question.id }),
          label: question.label,
          type: question.type,
          ...(question.type === "choice" && { options: question.options.split(",").map((option) => option.trim()).filter(Boolean) }),
          required: question.required,
        })),
        waitingList,
        opensDaysBefore: whole(opensDaysBefore),
        closesHoursBefore: whole(closesHoursBefore) ?? 0,
        intro,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" data-testid="registration-dialog">
        <DialogHeader>
          <DialogTitle>{t("registrations.settingsTitle")}</DialogTitle>
          <DialogDescription>{t("registrations.settingsDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={open} onChange={(event) => setOpen(event.target.checked)} data-testid="registration-open" />
            {t("registrations.openLabel")}
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="registration-limit">{t("registrations.limit")}</Label>
              <Input id="registration-limit" type="number" min={1} max={100000} value={limit} placeholder={t("registrations.noLimit")} onChange={(event) => setLimit(event.target.value)} data-testid="registration-limit" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="registration-opens">{t("registrations.opensDaysBefore")}</Label>
              <Input id="registration-opens" type="number" min={0} max={365} value={opensDaysBefore} placeholder={t("registrations.opensNow")} onChange={(event) => setOpensDaysBefore(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="registration-closes">{t("registrations.closesHoursBefore")}</Label>
              <Input id="registration-closes" type="number" min={0} max={1440} value={closesHoursBefore} onChange={(event) => setClosesHoursBefore(event.target.value)} />
            </div>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("registrations.placeKinds")}</legend>
            <p className="text-xs text-muted-foreground">{t("registrations.placeKindsHint")}</p>
            {kinds.map((kind, index) => {
              const set = (change: Partial<KindDraft>) => setKinds(kinds.map((one, at) => (at === index ? { ...one, ...change } : one)));
              return (
                <div key={kind.id ?? `new-${index}`} className="grid grid-cols-[1fr_5.5rem_6rem_auto] items-center gap-2" data-testid="registration-kind-row">
                  <Input required maxLength={60} value={kind.name} aria-label={t("registrations.kindName")} placeholder={t("registrations.kindName")} onChange={(event) => set({ name: event.target.value })} data-testid="registration-kind-name" />
                  <Input type="number" min={1} value={kind.limit} aria-label={t("registrations.kindLimit")} placeholder={t("registrations.kindLimit")} onChange={(event) => set({ limit: event.target.value })} data-testid="registration-kind-limit" />
                  <Input inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" value={kind.price} aria-label={t("registrations.kindPrice")} placeholder={t("registrations.kindPrice")} onChange={(event) => set({ price: event.target.value })} data-testid="registration-kind-price" />
                  <Button type="button" variant="ghost" size="icon" disabled={kinds.length === 1} aria-label={t("registrations.removeKind")} onClick={() => setKinds(kinds.filter((_, at) => at !== index))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={kinds.length >= 12} onClick={() => setKinds([...kinds, { name: "", limit: "", price: "" }])} data-testid="registration-add-kind">
                <Plus className="size-4" />
                {t("registrations.addKind")}
              </Button>
              {priced ? (
                <Input className="h-8 w-24" maxLength={3} value={currency} aria-label={t("registrations.currency")} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
              ) : null}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("registrations.questionsTitle")}</legend>
            {questions.map((question, index) => {
              const set = (change: Partial<QuestionDraft>) => setQuestions(questions.map((one, at) => (at === index ? { ...one, ...change } : one)));
              return (
                <div key={question.id ?? `new-${index}`} className="flex flex-col gap-2 rounded-md border p-2" data-testid="registration-question-row">
                  <div className="grid grid-cols-[1fr_8rem_auto] items-center gap-2">
                    <Input required maxLength={200} value={question.label} aria-label={t("registrations.questionLabel")} placeholder={t("registrations.questionLabel")} onChange={(event) => set({ label: event.target.value })} data-testid="registration-question-label" />
                    <NativeSelect value={question.type} aria-label={t("registrations.questionType")} onChange={(event) => set({ type: event.target.value as QuestionType })} data-testid="registration-question-type">
                      {QUESTION_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {t(`registrations.type_${type}`)}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button type="button" variant="ghost" size="icon" aria-label={t("registrations.removeQuestion")} onClick={() => setQuestions(questions.filter((_, at) => at !== index))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  {question.type === "choice" ? <Input required value={question.options} placeholder={t("registrations.optionsHint")} aria-label={t("registrations.options")} onChange={(event) => set({ options: event.target.value })} data-testid="registration-question-options" /> : null}
                  {question.type !== "yesno" ? (
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" className="size-4" checked={question.required} onChange={(event) => set({ required: event.target.checked })} />
                      {t("registrations.requiredLabel")}
                    </label>
                  ) : null}
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" className="self-start" disabled={questions.length >= 20} onClick={() => setQuestions([...questions, { label: "", type: "text", options: "", required: false }])} data-testid="registration-add-question">
              <Plus className="size-4" />
              {t("registrations.addQuestion")}
            </Button>
          </fieldset>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" checked={waitingList} onChange={(event) => setWaitingList(event.target.checked)} />
            <span className="flex flex-col">
              {t("registrations.waitingListLabel")}
              <span className="text-xs text-muted-foreground">{t("registrations.waitingListHint")}</span>
            </span>
          </label>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="registration-intro">{t("registrations.intro")}</Label>
            <Textarea id="registration-intro" rows={3} maxLength={2000} value={intro} placeholder={t("registrations.introHint")} onChange={(event) => setIntro(event.target.value)} />
          </div>
          {error ? <FieldError>{error}</FieldError> : null}
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            {onRemove ? <ConfirmButton label={t("registrations.remove")} confirmLabel={t("registrations.removeConfirm")} busyLabel={t("registrations.removing")} cancelLabel={t("registrations.keep")} onConfirm={onRemove} /> : <span />}
            <Button type="submit" disabled={pending} data-testid="registration-save">
              {pending ? t("registrations.saving") : t("registrations.saveSettings")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
