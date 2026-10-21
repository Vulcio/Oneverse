import { Injectable } from "@nestjs/common";
import type { Prisma } from "@oneverse/db";
import { AccessPolicyService } from "../access/access-policy.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
  ) {}

  findCategories(): Promise<Prisma.TagCategoryGetPayload<object>[]> {
    return this.prisma.client.tagCategory.findMany({
      orderBy: { sortOrder: "asc" },
    });
  }

  /**
   * Lists tags visible to the user: approved global tags, plus their own
   * private tags, plus their teams' private tags.
   */
  async findVisibleToUser(userId: string): Promise<Prisma.TagGetPayload<object>[]> {
    return this.prisma.client.tag.findMany({
      where: await this.access.tagsVisibleTo({ id: userId }),
      orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }],
    });
  }

}
