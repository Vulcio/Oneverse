import { type OpenPlace } from "@oneverse/core";
import { HandHelping } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { EntityAvatar } from "@oneverse/ui/components/entity-avatar";
import { usePartLabel } from "./lineup";

/**
 * Open places in other groups (issue #528): parts of their events open to
 * one of one's teams, with places left. Taking one puts one on its line-up
 * as a guest of the date. (One's own teams' open places show on their dates.)
 */
export function OpenPlacesCard({ places, onTake, busy }: { places: readonly OpenPlace[]; onTake: (place: OpenPlace) => void; busy: boolean }) {
  const { t, i18n } = useTranslation();
  const partLabel = usePartLabel([]);
  if (places.length === 0) return null;
  const when = (place: OpenPlace) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: place.timeZone }).format(new Date(place.startsAt));
  return (
    <Card data-testid="open-places">
      <CardHeader>
        <CardTitle>{t("teamCalendar.openPlacesTitle")}</CardTitle>
        <CardDescription>{t("teamCalendar.openPlacesDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {places.map((place) => (
            <li key={`${place.eventId}-${place.date}-${place.partKey}`} className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0" data-open-place={place.partKey}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{partLabel(place.part)}</span>
                {place.part.required ? <Badge variant="warning">{t("teamCalendar.partRequired")}</Badge> : null}
                {place.placesLeft > 1 ? <span className="text-xs text-muted-foreground">{t("teamCalendar.placesLeft", { count: place.placesLeft })}</span> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <EntityAvatar name={place.teamName} color={place.teamColor} avatarUrl={null} size={16} />
                <span>{place.teamName}</span>
                <span>·</span>
                <span>{place.title}</span>
                <span>·</span>
                <span className="tabular-nums">{when(place)}</span>
              </div>
              <div>
                <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => onTake(place)} data-testid="open-place-take">
                  <HandHelping />
                  {t("teamCalendar.volunteer", { part: partLabel(place.part) })}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
