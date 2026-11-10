import { createParamDecorator, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import type { AuthenticatedRequest, AuthenticatedUser } from "../types/authenticated-request.js";

/** The request's user, or a 401: what `@SignedIn()` gives, on its own so it can be tested. */
export function signedInUser(ctx: ExecutionContext): AuthenticatedUser {
  const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new UnauthorizedException();
  return user;
}

/**
 * Who is signed in, for a route that needs someone (issue #427): the user,
 * never undefined - a request without one is answered 401 before the method
 * runs. `@CurrentUser()` stays for the routes that also work signed out
 * (`@Public()` ones), where the user may be missing.
 */
export const SignedIn = createParamDecorator((_data: unknown, ctx: ExecutionContext) => signedInUser(ctx));
