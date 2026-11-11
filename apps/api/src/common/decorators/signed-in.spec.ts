import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vite-plus/test";
import type { AuthenticatedUser } from "../types/authenticated-request.js";
import { signedInUser } from "./signed-in.decorator.js";

const contextOf = (user: AuthenticatedUser | undefined) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;

describe("@SignedIn()", () => {
  it("gives the request's user", () => {
    const user = { id: "user_1" } as AuthenticatedUser;
    expect(signedInUser(contextOf(user))).toBe(user);
  });

  it("answers 401 when no one is signed in", () => {
    expect(() => signedInUser(contextOf(undefined))).toThrow(UnauthorizedException);
  });
});
