import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { KEY_OPTIONS } from "#/components/song-editor/song-form";
import { NativeSelect } from "@oneverse/ui/components/native-select";

/** A key, major or minor, as the song editor writes them; `noneLabel` names the empty choice. */
export function KeySelect({
  value,
  onChange,
  noneLabel,
  ...props
}: Omit<ComponentProps<typeof NativeSelect>, "value" | "onChange"> & { value: string; onChange: (value: string) => void; noneLabel?: string }) {
  const { t } = useTranslation();
  const known = [...KEY_OPTIONS.major, ...KEY_OPTIONS.minor].includes(value);
  return (
    <NativeSelect value={value} onChange={(event) => onChange(event.target.value)} {...props}>
      <option value="">{noneLabel ?? t("songEditor.none")}</option>
      {value && !known ? <option value={value}>{value}</option> : null}
      <optgroup label={t("songEditor.major")}>
        {KEY_OPTIONS.major.map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </optgroup>
      <optgroup label={t("songEditor.minor")}>
        {KEY_OPTIONS.minor.map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </optgroup>
    </NativeSelect>
  );
}
