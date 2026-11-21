import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const settings = { addressLookup: true, photonUrl: "https://photon.test", addressLookupFrance: true };
vi.mock("./organization-settings.js", () => ({ getEffectiveOrganizationSettings: async () => settings }));
const { checkAddress, suggestAddresses } = await import("./address-lookup.js");

const ban = { features: [{ properties: { label: "8 Quai des Chartrons 33000 Bordeaux", name: "8 Quai des Chartrons", postcode: "33000", city: "Bordeaux", type: "housenumber" } }] };
const photon = {
  features: [
    { properties: { housenumber: "1", street: "Unter den Linden", postcode: "10117", city: "Berlin", countrycode: "DE", country: "Germany", type: "house" } },
    { properties: { housenumber: "1", street: "Linden Street", postcode: "02139", city: "Cambridge", countrycode: "US", country: "United States", type: "house" } },
  ],
};

describe("address lookup (issue #533)", () => {
  let asked: string[];
  beforeEach(() => {
    asked = [];
    settings.addressLookup = true;
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(String(url));
      if (String(url).includes("down")) throw new Error("down");
      return new Response(JSON.stringify(String(url).includes("geocodage") ? ban : photon));
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks the Base Adresse Nationale for France", async () => {
    const [first] = await suggestAddresses("8 quai des chartrons", "FR", "fr");
    expect(first).toMatchObject({ street: "8 Quai des Chartrons", postalCode: "33000", city: "Bordeaux", country: "FR", source: "ban" });
    expect(asked[0]).toContain("https://data.geopf.fr/geocodage/search?");
  });

  it("asks Photon elsewhere and keeps the country's, number after the street in Germany", async () => {
    const found = await suggestAddresses("unter den linden 1", "DE");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ street: "Unter den Linden 1", postalCode: "10117", city: "Berlin", source: "photon" });
    expect(asked[0]).toContain("https://photon.test/api?");
  });

  it("suggests nothing when it's off or too short", async () => {
    expect(await suggestAddresses("8q", "FR")).toEqual([]);
    settings.addressLookup = false;
    expect(await suggestAddresses("8 quai des chartrons bordeaux", "FR")).toEqual([]);
    expect(await checkAddress({ street: "8 quai des Chartrons", postalCode: "33000", city: "Bordeaux", country: "FR" })).toBeNull();
    expect(asked).toEqual([]);
  });

  it("finds an address with its number in its postal code, or not", async () => {
    expect(await checkAddress({ street: "8 quai des Chartrons", postalCode: "33 000", city: "Bordeaux", country: "FR" })).toEqual({ found: true, as: "8 Quai des Chartrons 33000 Bordeaux · BAN" });
    expect(await checkAddress({ street: "12 quai des Chartrons", postalCode: "33000", city: "Bordeaux", country: "FR" })).toEqual({ found: false, as: null });
    expect(await checkAddress({ street: "Linden Street 1", postalCode: "10117", city: "Berlin", country: "US" })).toEqual({ found: false, as: null });
  });

  it("doesn't know when the service doesn't answer", async () => {
    settings.photonUrl = "https://down.test";
    expect(await checkAddress({ street: "Somewhere 3", postalCode: "1000", city: "Lausanne", country: "CH" })).toBeNull();
    settings.photonUrl = "https://photon.test";
  });
});
