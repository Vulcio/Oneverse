import type { CustomInstrument, OrganizationTeam, TeamEventType } from "@oneverse/core";
import { Shapes } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { usePlanning } from "../host";
import { EventTypesDialog } from "./event-types";
import { usePartLabel } from "./lineup";

/**
 * An organisation's event types (issue #528), for its admins: what a
 * service, a prayer night or a meeting asks for - required parts, places
 * open to its groups - and whether its dates get a set. Every group picks
 * from them on its calendar, and can still ask for more on an event.
 */
export function OrganizationEventTypesButton({ organizationId, teams }: { organizationId: string; teams: readonly OrganizationTeam[] }) {
  const { api, sets } = usePlanning();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<TeamEventType[]>([]);
  const [customInstruments, setCustomInstruments] = useState<CustomInstrument[]>([]);
  const partLabel = usePartLabel(customInstruments);
  const load = async () => setTypes(await api.listOrganizationEventTypes(organizationId));
  useEffect(() => {
    if (!open) return;
    void load();
    void api.listCustomInstruments().then(setCustomInstruments, () => {});
  }, [open, organizationId]);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="organization-event-types">
        <Shapes />
        {t("teamCalendar.eventTypes")}
      </Button>
      {open ? (
        <EventTypesDialog
          owner={{ organizationId, teams: teams.map((team) => ({ id: team.id, name: team.name })) }}
          types={types}
          // Sets aren't only songs: wherever the app keeps sets, a type says whether its dates get one.
          makesSets={!!sets}
          teamNames={[]}
          positions={[]}
          customInstruments={customInstruments}
          partLabel={partLabel}
          onChanged={load}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
