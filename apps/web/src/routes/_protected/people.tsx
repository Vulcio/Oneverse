import type { PeopleOverview, Person } from "@songverse/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "#/components/confirm-button";
import { Avatar, AvatarFallback, AvatarImage } from "@songverse/ui/components/avatar";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { apiClient } from "#/lib/api-client";
import { sizedAvatarUrl } from "#/lib/avatar-url";
import { initials } from "#/lib/initials";

export const Route = createFileRoute("/_protected/people")({
  loader: () => apiClient.getPeople(),
  component: PeoplePage,
});

function PersonName({ person, detail }: { person: Person; detail?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar className="size-8">
        {person.avatarUrl ? <AvatarImage src={sizedAvatarUrl(person.avatarUrl, 64)} alt="" /> : null}
        <AvatarFallback className="text-xs">{initials(person.displayName)}</AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{person.displayName}</span>
        {detail ? <span className="truncate text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </span>
  );
}

/**
 * People (issue #77): who you're connected to, so you can share songs with
 * each other. Ask by email; they say yes or no; people from your teams are
 * a click away.
 */
function PeoplePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const overview: PeopleOverview = Route.useLoaderData();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function run(action: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await router.invalidate();
      if (ok) setMessage({ kind: "ok", text: ok });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function ask(to: { email?: string; userId?: string }) {
    await run(async () => {
      const { connected } = await apiClient.requestConnection(to);
      setEmail("");
      setMessage({ kind: "ok", text: t(connected ? "people.connected" : "people.asked") });
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("people.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("people.description")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("people.addTitle")}</CardTitle>
          <CardDescription>{t("people.addDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (email.trim()) void ask({ email: email.trim() });
            }}
          >
            <div className="flex min-w-56 flex-1 flex-col gap-1.5">
              <Label htmlFor="people-email">{t("people.email")}</Label>
              <Input id="people-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" />
            </div>
            <Button type="submit" disabled={busy || !email.trim()}>
              {t("people.ask")}
            </Button>
          </form>
          {message ? (
            <p className={`mt-3 text-sm ${message.kind === "error" ? "text-destructive" : "text-muted-foreground"}`} role={message.kind === "error" ? "alert" : "status"}>
              {message.text}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {overview.incoming.length > 0 ? (
        <Card data-testid="people-incoming">
          <CardHeader>
            <CardTitle>{t("people.incomingTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {overview.incoming.map((request) => (
                <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <PersonName person={request.from} detail={request.from.email} />
                  <span className="flex gap-2">
                    <Button size="sm" disabled={busy} onClick={() => void run(() => apiClient.acceptConnection(request.id))}>
                      {t("people.accept")}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => apiClient.declineConnection(request.id))}>
                      {t("people.decline")}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card data-testid="people-list">
        <CardHeader>
          <CardTitle>{t("people.yourPeople")}</CardTitle>
          <CardDescription>{t("people.yourPeopleDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {overview.people.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("people.none")}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {overview.people.map((person) => (
                <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <PersonName person={person} detail={person.email} />
                  <ConfirmButton
                    label={t("people.remove")}
                    confirmLabel={t("people.confirmRemove")}
                    busyLabel={t("people.removing")}
                    cancelLabel={t("songEditor.cancel")}
                    busy={busy}
                    onConfirm={() => run(() => apiClient.removePerson(person.id))}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {overview.outgoing.length > 0 ? (
        <Card data-testid="people-outgoing">
          <CardHeader>
            <CardTitle>{t("people.outgoingTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {overview.outgoing.map((request) => (
                <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
                  <span className="truncate">{request.email}</span>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => apiClient.cancelConnection(request.id))}>
                    {t("people.cancel")}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {overview.suggestions.length > 0 ? (
        <Card data-testid="people-suggestions">
          <CardHeader>
            <CardTitle>{t("people.suggestionsTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {overview.suggestions.map((person) => (
                <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <PersonName person={person} />
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void ask({ userId: person.id })}>
                    {t("people.ask")}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
