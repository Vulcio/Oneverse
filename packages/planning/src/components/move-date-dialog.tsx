import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { DatePicker } from "@oneverse/ui/components/date-picker";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { FieldError } from "@oneverse/ui/components/field";
import { Label } from "@oneverse/ui/components/label";

/**
 * One date moved to another day (issue #576), a team's or an organisation's:
 * its answers, line-up and set go with it, and those signed up are told.
 * The server refuses a day the event is on already, and says so here.
 */
export function MoveDateDialog({ date, title, onClose, onMove }: { date: string; title: string; onClose: () => void; onMove: (to: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [to, setTo] = useState(date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="move-date-dialog">
        <DialogHeader>
          <DialogTitle>{t("teamCalendar.moveDate")}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t("teamCalendar.moveDateHint", { date: title })}</p>
        </DialogHeader>
        <form
          id="move-date-form"
          className="flex flex-col gap-1.5"
          onSubmit={(submitted) => {
            submitted.preventDefault();
            if (to === date) return onClose();
            setBusy(true);
            setError(null);
            onMove(to)
              .catch((failed: unknown) => setError(failed instanceof Error ? failed.message : String(failed)))
              .finally(() => setBusy(false));
          }}
        >
          <Label htmlFor="move-date-to">{t("teamCalendar.moveDateTo")}</Label>
          <DatePicker id="move-date-to" value={to} onChange={setTo} testId="move-date-to" />
          {error ? <FieldError>{error}</FieldError> : null}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("teamCalendar.cancel")}
          </Button>
          <Button type="submit" form="move-date-form" disabled={busy || to === date} data-testid="move-date-save">
            {t("teamCalendar.moveDateSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
