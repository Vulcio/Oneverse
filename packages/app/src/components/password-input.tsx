import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@oneverse/ui/components/input";

/** A password field one can look at (issue #422): the eye shows what was typed, and hides it again. */
export function PasswordInput(props: Omit<ComponentProps<typeof Input>, "type">) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={shown ? "text" : "password"} className="pr-9" />
      <button
        type="button"
        aria-label={shown ? t("auth.hidePassword") : t("auth.showPassword")}
        aria-pressed={shown}
        title={shown ? t("auth.hidePassword") : t("auth.showPassword")}
        data-testid={props.id ? `${props.id}-show` : undefined}
        onClick={() => setShown((s) => !s)}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4"
      >
        {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
      </button>
    </div>
  );
}
