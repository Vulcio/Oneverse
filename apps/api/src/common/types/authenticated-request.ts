import type { Request } from "express";

export interface AuthenticatedUser {
  id: string;
  email: string;
  isGlobalAdmin: boolean;
  /** May review songs submitted to the global catalogue (global admins always can). */
  isReviewer: boolean;
  /** Signed up asking for an organisation, not approved yet (issue #533). */
  awaitingApproval?: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
