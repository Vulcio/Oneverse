import { SetMetadata } from "@nestjs/common";

export const WHILE_AWAITING_APPROVAL_KEY = "whileAwaitingApproval";

/**
 * Open to someone who signed up asking for an organisation and waits for
 * its approval (issue #533): their own profile and their request. Every
 * other route refuses them (JwtAuthGuard).
 */
export const WhileAwaitingApproval = () => SetMetadata(WHILE_AWAITING_APPROVAL_KEY, true);
