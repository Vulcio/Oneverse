import { describe, expect, it } from "vite-plus/test";
import { AppController } from "./app.controller.js";
import { resolveVersion } from "./common/version.js";
import type { PrismaService } from "./prisma/prisma.service.js";

describe("AppController", () => {
  it("reports ok, the version and the latest migration on the public health endpoint", async () => {
    let reads = 0;
    const prisma = { client: { $queryRaw: () => (reads++, Promise.resolve([{ migration_name: "20270109000000_backups" }])) } } as unknown as PrismaService;
    const controller = new AppController(prisma);
    const health = await controller.health();
    expect(health).toMatchObject({ status: "ok", migration: "20270109000000_backups" });
    expect(health.version).toMatch(/^\d+\.\d+\.\d+/);
    await controller.health();
    expect(reads).toBe(1);
  });

  it("still answers when the database can't be read", async () => {
    const prisma = { client: { $queryRaw: () => Promise.reject(new Error("down")) } } as unknown as PrismaService;
    expect(await new AppController(prisma).health()).toMatchObject({ status: "ok", migration: null });
  });
});

describe("resolveVersion", () => {
  it("is the release's exact version in a release image, else the workspace's as -dev", () => {
    expect(resolveVersion({ ONEVERSE_VERSION: "v0.9.0", ONEVERSE_COMMIT: "82f6ce9abcdef0123456" }, () => "0.9.0")).toEqual({ version: "0.9.0", commit: "82f6ce9abcde" });
    expect(resolveVersion({}, () => "0.9.0")).toEqual({ version: "0.9.0-dev", commit: null });
  });
});
