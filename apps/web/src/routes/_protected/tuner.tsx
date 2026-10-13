import { createFileRoute } from "@tanstack/react-router";
import { Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@songverse/ui/components/card";

export const Route = createFileRoute("/_protected/tuner")({
  component: TunerPage,
});

/** The Tuner, in the sidebar's Tools with the metronome (issue #147): a placeholder for now. */
function TunerPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6" data-testid="tuner">
      <h1 className="text-2xl font-semibold">{t("nav.tuner")}</h1>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Gauge className="size-10 text-muted-foreground" aria-hidden />
          <p className="font-medium">{t("tuner.comingSoon")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("tuner.description")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
