import { Controller, Get } from "@nestjs/common";
import { ApiExcludeEndpoint } from "@nestjs/swagger";
import { Public } from "../common/decorators/public.decorator.js";
import { getEffectiveAuthSettings } from "./auth-settings.js";
import { getEffectiveSecuritySettings } from "../security/security-settings.js";
import { organizationSignupOpen } from "../invitations/signup-gate.js";

/**
 * The one piece of auth config unauthenticated pages need to know: whether
 * to render the "Continue with Google" button (apps/web's auth-card.tsx).
 * Deliberately separate from AdminController's /admin/auth (which is
 * global-admin-only and returns the full config summary) - this endpoint
 * is public and returns nothing sensitive, not even a source indicator.
 */
@Controller("auth")
export class AuthConfigController {
  @Public()
  @Get("public-config")
  @ApiExcludeEndpoint()
  async publicConfig() {
    const [settings, security] = await Promise.all([getEffectiveAuthSettings(), getEffectiveSecuritySettings()]);
    // Whether to offer sign-up to anyone, or only with an invitation (issue #198).
    // Or, besides invitations, by asking for an organisation (issue #533).
    return { hasGoogleAuth: Boolean(settings.googleClientId && settings.googleClientSecret), signupInviteOnly: security.signupInviteOnly, signupOrganizationRequests: await organizationSignupOpen() };
  }
}
