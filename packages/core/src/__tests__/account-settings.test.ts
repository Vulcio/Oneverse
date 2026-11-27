import { describe, expect, it } from "vite-plus/test";
import { NOTIFICATION_KINDS, NOTIFICATION_SECTIONS, notificationSectionsFor } from "../notifications/index.js";
import { joinedName, nameParts } from "../constants/index.js";

describe("notification sections (issue #540)", () => {
  it("puts every kind in exactly one section", () => {
    const listed = NOTIFICATION_SECTIONS.flatMap((section) => section.kinds as readonly string[]);
    expect([...listed].sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });

  it("shows Teams you run only to those who run one, asks for an organisation only to server admins", () => {
    const member = notificationSectionsFor({ runsTeams: false, serverAdmin: false });
    expect(member.map((section) => section.key)).not.toContain("running");
    expect(member.find((section) => section.key === "organizations")?.kinds).not.toContain("ORGANIZATION_REQUESTED");
    const admin = notificationSectionsFor({ runsTeams: true, serverAdmin: false });
    expect(admin.map((section) => section.key)).toContain("running");
    const server = notificationSectionsFor({ runsTeams: false, serverAdmin: true });
    expect(server.find((section) => section.key === "organizations")?.kinds).toContain("ORGANIZATION_REQUESTED");
  });
});

describe("a name in two parts (issue #540)", () => {
  it("splits a name never set in two at its first space", () => {
    expect(nameParts({ displayName: "Jean Paul Martin" })).toEqual({ firstName: "Jean", lastName: "Paul Martin" });
    expect(nameParts({ displayName: "Brice" })).toEqual({ firstName: "Brice", lastName: "" });
  });

  it("keeps what was set, and joins the two", () => {
    expect(nameParts({ displayName: "Jean Paul Martin", firstName: "Jean Paul", lastName: "Martin" })).toEqual({ firstName: "Jean Paul", lastName: "Martin" });
    expect(joinedName(" Brice ", "Dupuy")).toBe("Brice Dupuy");
    expect(joinedName("", "Dupuy")).toBe("Dupuy");
  });
});
