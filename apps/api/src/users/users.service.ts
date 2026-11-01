import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { INSTRUMENTS, mergeDisplaySettings, orderInstruments, orderTechRoles, type SavedDisplaySettings } from "@oneverse/core";
import type { Prisma } from "@oneverse/db";
import { PrismaService } from "../prisma/prisma.service.js";
import { ImageService } from "../images/image.service.js";
import { StorageQuotaService } from "../storage/storage-quota.service.js";
import { StorageService } from "../storage/storage.service.js";
import { detectAvatarImageType } from "./avatar-image.js";
import { capabilitiesOf } from "../roles/capabilities.js";
import { customInstrumentIds } from "../instruments/instruments.service.js";
import type { UpdateUserDto } from "./dto/update-user.dto.js";

const SELECT = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  locale: true,
  displayMode: true,
  capoDisplayMode: true,
  chordNotation: true,
  liveView: true,
  chordDiagrams: true,
  chordColors: true,
  leftHanded: true,
  weekStartsOn: true,
  guitarTuning: true,
  ukuleleTuning: true,
  pianoSmooth: true,
  pianoHands: true,
  pianoNoteNames: true,
  displaySettings: true,
  voicingPreference: true,
  isGlobalAdmin: true,
  instruments: true,
  techRoles: true,
  profilePromptSkippedAt: true,
} as const;

/** How long a skipped "What do you play or do?" waits before it's asked again (issue #109). */
export const PROFILE_PROMPT_AGAIN_DAYS = 30;

/**
 * Whether to ask "What do you play or do?" (issue #109): nothing said yet,
 * and not skipped lately (joining a team asks again, see TeamsService).
 */
function asksProfile(user: { instruments: string[]; techRoles: string[]; profilePromptSkippedAt: Date | null }): boolean {
  if (user.instruments.length > 0 || user.techRoles.length > 0) return false;
  return !user.profilePromptSkippedAt || Date.now() - user.profilePromptSkippedAt.getTime() > PROFILE_PROMPT_AGAIN_DAYS * 86_400_000;
}

/** Stored roles no longer on the lists are dropped, the rest shown in list order; whether to ask what they play (issue #109), not when they skipped it. */
function toProfile<T extends { instruments: string[]; techRoles: string[]; profilePromptSkippedAt: Date | null }>(user: T, customInstruments: readonly string[]) {
  const rest: Omit<T, "profilePromptSkippedAt"> & { profilePromptSkippedAt?: Date | null } = { ...user };
  delete rest.profilePromptSkippedAt;
  return { ...(rest as Omit<T, "profilePromptSkippedAt">), instruments: orderInstruments(user.instruments, customInstruments), techRoles: orderTechRoles(user.techRoles), askProfile: asksProfile(user) };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly quota: StorageQuotaService,
    private readonly images: ImageService,
  ) {}

  async findMe(userId: string) {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId }, select: SELECT });
    if (!user) throw new NotFoundException("User not found");
    return this.withRoles(toProfile(user, await customInstrumentIds(this.prisma.client)));
  }

  /** "What do you play or do?" skipped (issue #109): asked again in a while. */
  async skipProfilePrompt(userId: string): Promise<void> {
    await this.prisma.client.user.update({ where: { id: userId }, data: { profilePromptSkippedAt: new Date() } });
  }

  /** What their roles allow them (issue #160), and which roles they have - their own and their teams'. */
  private async withRoles<T extends { id: string }>(user: T) {
    const capabilities = await capabilitiesOf(this.prisma.client, user.id);
    const roles = await this.prisma.client.role.findMany({ where: { id: { in: capabilities.roleIds } }, select: { name: true }, orderBy: { name: "asc" } });
    return {
      ...user,
      isReviewer: capabilities.canReview,
      canSeparateStems: capabilities.canSeparateStems,
      // Audio files (issue #183): a role's, or a global admin's.
      canUploadAudio: capabilities.canUploadAudio || ("isGlobalAdmin" in user && user.isGlobalAdmin === true),
      roles: roles.map((role) => role.name),
      permissions: capabilities.permissions,
    };
  }

  async updateMe(userId: string, dto: UpdateUserDto) {
    const custom = await customInstrumentIds(this.prisma.client);
    // A built-in instrument or one an admin added (issue #166); anything else is refused, by name.
    const unknown = dto.instruments?.filter((value) => !(INSTRUMENTS as readonly string[]).includes(value) && !custom.includes(value)) ?? [];
    if (unknown.length > 0) throw new BadRequestException([`instruments must be on the list: ${unknown.join(", ")} isn't`]);
    // A mode's display settings (issue #209): merged into what's kept, null back to the account's.
    const displaySettings = dto.displaySettings
      ? mergeDisplaySettings(
          ((await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId }, select: { displaySettings: true } })).displaySettings ?? {}) as SavedDisplaySettings,
          dto.displaySettings,
        )
      : undefined;
    const user = await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        ...(displaySettings && { displaySettings: displaySettings as Prisma.InputJsonValue }),
        locale: dto.locale,
        displayName: dto.displayName,
        capoDisplayMode: dto.capoDisplayMode,
        chordNotation: dto.chordNotation,
        liveView: dto.liveView,
        chordDiagrams: dto.chordDiagrams,
        chordColors: dto.chordColors,
        leftHanded: dto.leftHanded,
        weekStartsOn: dto.weekStartsOn,
        guitarTuning: dto.guitarTuning,
        ukuleleTuning: dto.ukuleleTuning,
        pianoSmooth: dto.pianoSmooth,
        pianoHands: dto.pianoHands,
        pianoNoteNames: dto.pianoNoteNames,
        instruments: dto.instruments && orderInstruments(dto.instruments, custom),
        techRoles: dto.techRoles && orderTechRoles(dto.techRoles),
      },
      select: SELECT,
    });
    return this.withRoles(toProfile(user, custom));
  }

  getStorageUsage(userId: string) {
    return this.quota.getUsage(userId);
  }

  /**
   * Stored normalized (square, at most 512px, WebP, no metadata) whatever the
   * client sent. Avatars don't count toward the storage limit.
   */
  async setAvatar(userId: string, upload: Buffer) {
    const { body, contentType } = await this.images.normalizeAvatar(upload);
    const previous = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarStorageKey: true } });
    const { hash } = await this.storage.put(body, contentType);
    const user = await this.prisma.client.user.update({
      where: { id: userId },
      data: { avatarStorageKey: hash, avatarUrl: this.avatarUrlFor(userId, hash) },
      select: SELECT,
    });
    if (previous.avatarStorageKey && previous.avatarStorageKey !== hash) {
      await this.storage.deleteUnreferenced([previous.avatarStorageKey]);
    }
    return toProfile(user, await customInstrumentIds(this.prisma.client));
  }

  async removeAvatar(userId: string) {
    const previous = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarStorageKey: true } });
    const user = await this.prisma.client.user.update({
      where: { id: userId },
      data: { avatarStorageKey: null, avatarUrl: null },
      select: SELECT,
    });
    if (previous.avatarStorageKey) await this.storage.deleteUnreferenced([previous.avatarStorageKey]);
    return toProfile(user, await customInstrumentIds(this.prisma.client));
  }

  /**
   * Public, but only ever serves a user's *current* avatar: storage keys are
   * content hashes shared with attachments, so serving any key on request
   * would expose private files.
   */
  async getAvatar(userId: string, key: string, size?: number): Promise<{ body: Buffer; contentType: string }> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { avatarStorageKey: true, deletedAt: true },
    });
    if (!user || user.deletedAt || !user.avatarStorageKey || user.avatarStorageKey !== key) {
      throw new NotFoundException("Avatar not found");
    }
    if (size !== undefined) {
      return this.images.resize(key, () => this.storage.get(key), size);
    }
    const body = await this.storage.get(key);
    return { body, contentType: detectAvatarImageType(body) ?? "application/octet-stream" };
  }

  // Absolute, since the web app renders it from a different origin. The key
  // in the path changes with every new image, so it can be cached forever.
  private avatarUrlFor(userId: string, key: string): string {
    const apiOrigin = new URL(this.config.get<string>("AUTH_URL") ?? "http://localhost:3001").origin;
    return `${apiOrigin}/users/${userId}/avatar/${key}`;
  }
}
