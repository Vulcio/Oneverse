import { useTranslation } from "react-i18next";
import { LogOut } from "lucide-react";
import { authClient } from "@oneverse/app/auth-client";
import { ThemeSwitch } from "@oneverse/app/components/theme-switch";
import { Button } from "@oneverse/ui/components/button";
import { OneverseBrand } from "#/components/brand";

/** Oneverse's name, light or dark (issue #422), and signing out of it. */
export function AppHeader() {
  const { t } = useTranslation();
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 font-semibold">
          <OneverseBrand />
        </div>
        <div className="flex items-center gap-2">
        <ThemeSwitch />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void authClient.signOut().then(() => {
              window.location.href = "/sign-in";
            });
          }}
          data-testid="sign-out"
        >
          <LogOut />
          {t("nav.signOut")}
        </Button>
        </div>
      </div>
    </header>
  );
}
