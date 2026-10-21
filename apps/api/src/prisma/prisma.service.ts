import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { prisma, type PrismaClient } from "@oneverse/db";

/**
 * Thin NestJS wrapper around the shared @oneverse/db Prisma client
 * singleton — keeps the same connection pool the seed script and any
 * BullMQ worker process use, injectable via DI for testability.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient = prisma;

  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
