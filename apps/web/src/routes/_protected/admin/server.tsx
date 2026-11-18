import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import type { AdminCommandResult } from "@oneverse/core";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { BackgroundJobsCard } from "./-background-jobs";

/** Admin > Server (issue #518): the version running, the background jobs, and the database's maintenance tasks - once under Metadata. */
export const Route = createFileRoute("/_protected/admin/server")({
  component: AdminServerPage,
});

function ResultPanel({ result }: { result: AdminCommandResult | null }) {
  if (!result) return null;
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return (
    <div className="flex flex-col gap-1.5">
      <p className={`text-sm font-medium ${result.ok ? "text-foreground" : "text-destructive"}`}>
        {result.command} — {result.ok ? "done" : "failed"}
      </p>
      {output ? (
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{output}</pre>
      ) : null}
    </div>
  );
}

function AdminServerPage() {
  const { t } = useTranslation();
  const [statusResult, setStatusResult] = useState<AdminCommandResult | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [seedResult, setSeedResult] = useState<AdminCommandResult | null>(null);
  const [seeding, setSeeding] = useState(false);

  async function checkStatus() {
    setCheckingStatus(true);
    try {
      setStatusResult(await apiClient.adminMigrationStatus());
    } finally {
      setCheckingStatus(false);
    }
  }

  async function runSeed() {
    setSeeding(true);
    try {
      setSeedResult(await apiClient.adminRunSeed());
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("nav.adminServer")}</h1>
        <p className="text-sm text-muted-foreground">{t("admin.serverPageDescription")}</p>
      </div>

      <BackgroundJobsCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("admin.serverAndApi")}</CardTitle>
          <CardDescription>{t("admin.serverAndApiDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t("admin.migrationStatus")}</p>
                <p className="text-sm text-muted-foreground">{t("admin.migrationStatusDescription")}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void checkStatus()} disabled={checkingStatus}>
                {checkingStatus ? t("admin.checking") : t("admin.checkStatus")}
              </Button>
            </div>
            <ResultPanel result={statusResult} />
          </div>

          <div className="flex flex-col gap-2 border-t pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t("admin.runSeed")}</p>
                <p className="text-sm text-muted-foreground">{t("admin.runSeedDescription")}</p>
              </div>
              <ConfirmButton
                label={t("admin.runSeed")}
                confirmLabel={t("admin.confirm")}
                busyLabel={t("admin.running")}
                cancelLabel={t("admin.cancel")}
                busy={seeding}
                onConfirm={runSeed}
              />
            </div>
            <ResultPanel result={seedResult} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
