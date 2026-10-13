import { ISO_639_1_CODES, getLanguageDisplayName } from "@songverse/core";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { cn } from "@songverse/ui/lib/utils";

interface LanguageSelectProps {
  id?: string;
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  /** Renders a leading "none" option that clears the field - for optional language fields. */
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
}

/**
 * A language should never be free text (see docs) - this is the one
 * place in the app a language field is entered, always storing an ISO
 * 639-1 code while showing the reader's own localized language name
 * (via Intl.DisplayNames, not a hardcoded name table).
 */
export function LanguageSelect({
  id,
  value,
  onChange,
  disabled,
  allowEmpty,
  emptyLabel,
  className,
}: LanguageSelectProps) {
  const { i18n } = useTranslation();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Names come from the runtime's ICU data, which can differ between the
  // server and a browser - and sorting by them can then order the options
  // differently, which hydration wouldn't repair. So the first render lists
  // them by code (the same everywhere) and sorts by name once mounted.
  const options = useMemo(() => {
    const list = ISO_639_1_CODES.map((code) => ({ code, name: getLanguageDisplayName(code, i18n.language) }));
    return mounted ? list.sort((a, b) => a.name.localeCompare(b.name)) : list;
  }, [i18n.language, mounted]);

  return (
    <NativeSelect
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn("w-full", className)}
    >
      {allowEmpty ? <option value="">{emptyLabel ?? ""}</option> : null}
      {options.map(({ code, name }) => (
        <option key={code} value={code} suppressHydrationWarning>
          {name} ({code})
        </option>
      ))}
    </NativeSelect>
  );
}
