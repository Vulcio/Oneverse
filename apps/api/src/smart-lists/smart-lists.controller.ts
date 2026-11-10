import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { CreateSmartListDto, UpdateSmartListDto } from "./smart-list.dto.js";
import { SmartListsService } from "./smart-lists.service.js";

/** Saved library filters (issue #58), each user's own. */
@ApiTags("smart-lists")
@ApiBearerAuth()
@Controller("smart-lists")
export class SmartListsController {
  constructor(private readonly smartLists: SmartListsService) {}

  @Get()
  list(@SignedIn() user: AuthenticatedUser): ReturnType<SmartListsService["list"]> {
    return this.smartLists.list(user.id);
  }

  @Post()
  create(@SignedIn() user: AuthenticatedUser, @Body() dto: CreateSmartListDto): ReturnType<SmartListsService["create"]> {
    return this.smartLists.create(user.id, dto);
  }

  @Patch(":id")
  update(@SignedIn() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateSmartListDto): ReturnType<SmartListsService["update"]> {
    return this.smartLists.update(user.id, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@SignedIn() user: AuthenticatedUser, @Param("id") id: string): Promise<void> {
    return this.smartLists.remove(user.id, id);
  }
}
