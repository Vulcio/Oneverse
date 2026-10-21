import { SOURCE_CODE_URL } from "@oneverse/core";
import { useTranslation } from "react-i18next";

/**
 * Songverse is free software under the AGPL-3.0: anyone using it over the
 * network is offered its source (the licence's section 13). A modified
 * copy running elsewhere points SOURCE_CODE_URL at its own source.
 */
export function SourceCodeLink() {
  const { t } = useTranslation();
  return (
    <p className="text-center text-xs text-muted-foreground" data-testid="source-code">
      {t("nav.freeSoftware")}{" "}
      <a href={SOURCE_CODE_URL} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-foreground">
        {t("nav.sourceCode")}
      </a>
    </p>
  );
}
