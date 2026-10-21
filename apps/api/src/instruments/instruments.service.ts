import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateInstrumentRequest, CustomInstrument, UpdateInstrumentRequest } from "@oneverse/core";
import { Prisma, type PrismaClient } from "@oneverse/db";
import { PrismaService } from "../prisma/prisma.service.js";

const SELECT = { id: true, label: true, translations: true } as const;

/** The ids of the instruments an admin added, in the order they're listed (issue #166). */
export async function customInstrumentIds(prisma: PrismaClient): Promise<string[]> {
  return (await prisma.customInstrument.findMany({ select: { id: true }, orderBy: [{ label: "asc" }, { id: "asc" }] })).map((row) => row.id);
}

function toInstrument(row: { id: string; label: string; translations: Prisma.JsonValue }): CustomInstrument {
  return { id: row.id, label: row.label, translations: (row.translations as Record<string, string> | null) ?? null };
}

/** French given: kept; empty: none, the English name is used. */
function translationsFrom(labelFr: string | undefined): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (labelFr === undefined) return undefined;
  return labelFr ? { fr: labelFr } : Prisma.DbNull;
}

/**
 * Admin > Instruments (issue #166): instruments added to the built-in list
 * (INSTRUMENTS in @oneverse/core), for anyone to pick what they play.
 */
@Injectable()
export class InstrumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<CustomInstrument[]> {
    const rows = await this.prisma.client.customInstrument.findMany({ select: SELECT, orderBy: [{ label: "asc" }, { id: "asc" }] });
    return rows.map(toInstrument);
  }

  /** With how many people play each. */
  async adminList(): Promise<(CustomInstrument & { userCount: number })[]> {
    const instruments = await this.list();
    const counts = await this.prisma.client.$queryRaw<{ id: string; count: bigint }[]>`
      select i.id, count(u.id) as count from "CustomInstrument" i
      left join "User" u on i.id = any(u.instruments)
      group by i.id`;
    const byId = new Map(counts.map((row) => [row.id, Number(row.count)]));
    return instruments.map((instrument) => ({ ...instrument, userCount: byId.get(instrument.id) ?? 0 }));
  }

  async create(input: CreateInstrumentRequest): Promise<CustomInstrument> {
    const row = await this.prisma.client.customInstrument.create({
      data: { label: input.label, translations: translationsFrom(input.labelFr ?? undefined) },
      select: SELECT,
    });
    return toInstrument(row);
  }

  async update(id: string, input: UpdateInstrumentRequest): Promise<CustomInstrument> {
    const row = await this.prisma.client.customInstrument
      .update({ where: { id }, data: { label: input.label ?? undefined, translations: translationsFrom(input.labelFr ?? undefined) }, select: SELECT })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") throw new NotFoundException("No such instrument");
        throw err;
      });
    return toInstrument(row);
  }

  /** Removed, and taken off whoever had picked it. */
  async remove(id: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.customInstrument.deleteMany({ where: { id } });
      if (count === 0) throw new NotFoundException("No such instrument");
      await tx.$executeRaw`update "User" set instruments = array_remove(instruments, ${id}) where ${id} = any(instruments)`;
    });
  }
}
