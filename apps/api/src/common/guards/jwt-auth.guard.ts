import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../prisma/prisma.service.js";
import { JwtVerifierService } from "../../auth/jwt-verifier.service.js";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator.js";
import { WHILE_AWAITING_APPROVAL_KEY } from "../decorators/while-awaiting-approval.decorator.js";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import { capabilitiesOf } from "../../roles/capabilities.js";

/**
 * Verifies the BetterAuth-issued Bearer JWT on every protected endpoint and
 * attaches `request.user`. Registered globally (see app.module.ts); opt out
 * per-route with @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtVerifier: JwtVerifierService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const payload = await this.jwtVerifier.verify(token);
    if (!payload.sub) {
      throw new UnauthorizedException("Token missing subject");
    }

    const user = await this.prisma.client.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, isGlobalAdmin: true, bannedAt: true, deletedAt: true, awaitingApprovalSince: true },
    });
    // Checked here as well as at sign-in: a JWT issued before a ban or
    // deletion would otherwise keep working until it expires.
    if (!user || user.deletedAt) {
      throw new UnauthorizedException("User no longer exists");
    }
    if (user.bannedAt) {
      throw new UnauthorizedException("Account banned");
    }

    // Waiting for their organisation's approval (issue #533): only their
    // profile and their request, until a global admin approves it.
    const awaitingApproval = !!user.awaitingApprovalSince && !user.isGlobalAdmin;
    if (awaitingApproval && !this.reflector.getAllAndOverride<boolean>(WHILE_AWAITING_APPROVAL_KEY, [context.getHandler(), context.getClass()])) {
      throw new ForbiddenException({ statusCode: 403, code: "ACCOUNT_AWAITING_APPROVAL", message: "Your account waits for your organisation to be approved" });
    }

    // What their roles allow (issue #160), as of this request.
    const capabilities = await capabilitiesOf(this.prisma.client, user.id);
    request.user = { id: user.id, email: user.email, isGlobalAdmin: user.isGlobalAdmin, isReviewer: capabilities.canReview, ...(awaitingApproval ? { awaitingApproval } : {}) };
    return true;
  }

  private extractToken(request: AuthenticatedRequest): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return null;
    return header.slice("Bearer ".length);
  }
}
