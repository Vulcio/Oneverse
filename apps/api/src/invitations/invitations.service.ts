import { randomBytes } from "node:crypto";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateSignupInvitationRequest, SignupInvitationPreview, SignupInvitationSummary } from "@oneverse/core";
import { PrismaService } from "../prisma/prisma.service.js";
import { sendSignupInvitation } from "../auth/email.js";
import { INVITATION_DAYS } from "./signup-gate.js";

const webUrl = () => (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Invitations to create an account (issue #198), sent by global admins. */
@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<SignupInvitationSummary[]> {
    const rows = await this.prisma.client.signupInvitation.findMany({
      orderBy: { createdAt: "desc" },
      include: { invitedBy: { select: { id: true, displayName: true } } },
    });
    return rows.map((row) => this.summary(row));
  }

  /** Invites an email - again, for one already invited: a new link, for another two weeks. */
  async create(admin: { id: string; displayName?: string | null }, input: CreateSignupInvitationRequest): Promise<SignupInvitationSummary> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.client.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
    if (existing) throw new ConflictException("Someone already has an account with this email.");
    const token = randomBytes(18).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);
    const row = await this.prisma.client.signupInvitation.upsert({
      where: { email },
      create: { email, token, expiresAt, invitedById: admin.id },
      update: { token, expiresAt, acceptedAt: null, invitedById: admin.id, createdAt: new Date() },
      include: { invitedBy: { select: { id: true, displayName: true } } },
    });
    const summary = this.summary(row);
    if (input.send !== false) await sendSignupInvitation(email, summary.link, row.invitedBy?.displayName ?? null);
    return summary;
  }

  async remove(id: string): Promise<void> {
    const { count } = await this.prisma.client.signupInvitation.deleteMany({ where: { id } });
    if (!count) throw new NotFoundException("This invitation doesn't exist any more.");
  }

  /** For the invitation's page, before signing up. */
  async preview(token: string): Promise<SignupInvitationPreview> {
    const row = await this.prisma.client.signupInvitation.findUnique({ where: { token } });
    if (!row) throw new NotFoundException("This invitation doesn't work any more. Ask for a new one.");
    return { email: row.email, status: row.acceptedAt ? "accepted" : row.expiresAt <= new Date() ? "expired" : "pending" };
  }

  private summary(row: {
    id: string;
    email: string;
    token: string;
    createdAt: Date;
    expiresAt: Date;
    acceptedAt: Date | null;
    invitedBy: { id: string; displayName: string } | null;
  }): SignupInvitationSummary {
    return {
      id: row.id,
      email: row.email,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      invitedBy: row.invitedBy,
      link: `${webUrl()}/invite/${row.token}`,
    };
  }
}
