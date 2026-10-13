import { INSTRUMENTS, type AdminCustomInstrument } from "@songverse/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "#/components/confirm-button";
import { Badge } from "@songverse/ui/components/badge";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/admin/instruments")({
  loader: () => apiClient.adminListInstruments(),
  component: AdminInstrumentsPage,
});

/**
 * Admin > Instruments (issue #166): the instruments people pick as what they
 * play - the built-in list, and the odd one an admin adds to it.
 */
function AdminInstrumentsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const instruments = Route.useLoaderData();
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await router.invalidate();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("nav.adminInstruments")}</h1>
        <p className="text-sm text-muted-foreground">{t("admin.instrumentsDescription")}</p>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("admin.instrumentsAdded")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {instruments.length === 0 ? <p className="text-sm text-muted-foreground">{t("admin.instrumentsNone")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="custom-instruments">
            {instruments.map((instrument) =>
              editing === instrument.id ? (
                <li key={instrument.id} className="py-3">
                  <InstrumentForm
                    instrument={instrument}
                    submitLabel={t("admin.instrumentSave")}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (label, labelFr) => {
                      if (await run(() => apiClient.adminUpdateInstrument(instrument.id, { label, labelFr }))) setEditing(null);
                    }}
                  />
                </li>
              ) : (
                <li key={instrument.id} className="flex flex-wrap items-center gap-3 py-3" data-testid={`custom-instrument-${instrument.label}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{instrument.label}</p>
                    {instrument.translations?.fr ? <p className="text-sm text-muted-foreground">{instrument.translations.fr}</p> : null}
                  </div>
                  <span className="text-xs text-muted-foreground">{t("admin.instrumentPlayers", { count: instrument.userCount })}</span>
                  <span className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(instrument.id)}>
                      {t("admin.instrumentEdit")}
                    </Button>
                    <ConfirmButton
                      label={t("admin.instrumentDelete")}
                      confirmLabel={t("admin.instrumentConfirmDelete")}
                      busyLabel={t("admin.instrumentDeleting")}
                      cancelLabel={t("admin.cancel")}
                      busy={deleting === instrument.id}
                      onConfirm={async () => {
                        setDeleting(instrument.id);
                        await run(() => apiClient.adminDeleteInstrument(instrument.id));
                        setDeleting(null);
                      }}
                    />
                  </span>
                </li>
              ),
            )}
          </ul>
          <InstrumentForm submitLabel={t("admin.instrumentAdd")} onSubmit={(label, labelFr) => run(() => apiClient.adminCreateInstrument({ label, labelFr }))} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("admin.instrumentsBuiltIn")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-wrap gap-1.5">
            {INSTRUMENTS.map((key) => (
              <li key={key}>
                <Badge variant="muted">{t(`roles.instrument.${key}`)}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/** An instrument's names: in English (and the fallback), and in French. Emptied after adding. */
function InstrumentForm({
  instrument,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  instrument?: AdminCustomInstrument;
  submitLabel: string;
  onSubmit: (label: string, labelFr: string) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(instrument?.label ?? "");
  const [labelFr, setLabelFr] = useState(instrument?.translations?.fr ?? "");
  const [pending, setPending] = useState(false);
  const id = instrument?.id ?? "new";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await onSubmit(label.trim(), labelFr.trim());
      if (!instrument) {
        setLabel("");
        setLabelFr("");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={submit} data-testid={`instrument-form-${id}`}>
      <div className="flex min-w-40 flex-1 flex-col gap-1.5">
        <Label htmlFor={`instrument-label-${id}`}>{t("admin.instrumentName")}</Label>
        <Input id={`instrument-label-${id}`} value={label} maxLength={40} required onChange={(event) => setLabel(event.target.value)} />
      </div>
      <div className="flex min-w-40 flex-1 flex-col gap-1.5">
        <Label htmlFor={`instrument-label-fr-${id}`}>{t("admin.instrumentNameFr")}</Label>
        <Input id={`instrument-label-fr-${id}`} value={labelFr} maxLength={40} placeholder={t("admin.instrumentNameFrHint")} onChange={(event) => setLabelFr(event.target.value)} />
      </div>
      <span className="flex gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("admin.cancel")}
          </Button>
        ) : null}
        <Button type="submit" disabled={pending || !label.trim()}>
          {instrument ? null : <Plus />}
          {pending && !instrument ? t("admin.instrumentAdding") : submitLabel}
        </Button>
      </span>
    </form>
  );
}
