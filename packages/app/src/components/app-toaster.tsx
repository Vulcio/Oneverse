import { Toaster } from "@oneverse/ui/components/toast";
import { useTranslation } from "react-i18next";

/** Where an app's toasts show (issue #425), its close button named in the page's language. Once, in the app's root. */
export function AppToaster() {
  const { t } = useTranslation();
  return <Toaster closeLabel={t("common.close")} />;
}
