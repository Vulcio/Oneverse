import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@oneverse/db";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CreateSmartListDto, UpdateSmartListDto } from "./smart-list.dto.js";

type SmartListFiltersDto = CreateSmartListDto["filters"];

const MAX_LISTS = 100;
const SELECT = { id: true, name: true, filters: true, createdAt: true, updatedAt: true } as const;

/** Only the filters that are set, so an empty one doesn't linger. */
function cleanFilters(filters: SmartListFiltersDto): Prisma.InputJsonObject {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => typeof value === "string" && value.trim() !== "")) as Prisma.InputJsonObject;
}

/** A user's smart lists (issue #58): saved library filters, theirs alone. */
@Injectable()
export class SmartListsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.client.smartList.findMany({ where: { userId }, select: SELECT, orderBy: [{ name: "asc" }, { createdAt: "asc" }] });
  }

  async create(userId: string, dto: CreateSmartListDto) {
    if ((await this.prisma.client.smartList.count({ where: { userId } })) >= MAX_LISTS) {
      throw new BadRequestException(`You can keep up to ${MAX_LISTS} smart lists`);
    }
    return this.prisma.client.smartList.create({ data: { userId, name: dto.name, filters: cleanFilters(dto.filters) }, select: SELECT });
  }

  async update(userId: string, id: string, dto: UpdateSmartListDto) {
    await this.own(userId, id);
    return this.prisma.client.smartList.update({
      where: { id },
      data: { ...(dto.name !== undefined && { name: dto.name }), ...(dto.filters !== undefined && { filters: cleanFilters(dto.filters) }) },
      select: SELECT,
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.own(userId, id);
    await this.prisma.client.smartList.delete({ where: { id } });
  }

  // Someone else's is as good as missing.
  private async own(userId: string, id: string) {
    const list = await this.prisma.client.smartList.findUnique({ where: { id }, select: { userId: true } });
    if (!list || list.userId !== userId) throw new NotFoundException("Smart list not found");
  }
}
