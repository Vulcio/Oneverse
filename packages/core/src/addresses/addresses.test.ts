import { describe, expect, it } from "vite-plus/test";
import { addressLine, countryHasPostalCodes, countryOptions, isCountryCode, postalCodeFits, tidyPostalCode } from "./index.js";

describe("addresses (issue #533)", () => {
  it("knows countries", () => {
    expect(isCountryCode("FR")).toBe(true);
    expect(isCountryCode("XX")).toBe(false);
    expect(countryOptions("fr").find((one) => one.code === "DE")?.name).toBe("Allemagne");
  });

  it("checks postal codes against their country's format", () => {
    expect(postalCodeFits("FR", "75002")).toBe(true);
    expect(postalCodeFits("FR", "7500")).toBe(false);
    expect(postalCodeFits("GB", "sw1a 1aa")).toBe(true);
    expect(postalCodeFits("US", "90210-1234")).toBe(true);
    expect(postalCodeFits("FR", "")).toBe(false);
  });

  it("needs none where a country has none", () => {
    expect(countryHasPostalCodes("HK")).toBe(false);
    expect(postalCodeFits("HK", "")).toBe(true);
  });

  it("tidies and writes addresses", () => {
    expect(tidyPostalCode("  sw1a   1aa ")).toBe("SW1A 1AA");
    expect(addressLine({ street: "12 rue de la Paix", postalCode: "75002", city: "Paris", country: "FR" }, "en")).toBe("12 rue de la Paix, 75002 Paris, France");
  });
});
