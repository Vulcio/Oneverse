import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CreateInstrumentSchema, UpdateInstrumentSchema } from "@oneverse/core";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import { zodDto } from "../common/zod-validation.js";
import { InstrumentsService } from "./instruments.service.js";

class CreateInstrumentDto extends zodDto(CreateInstrumentSchema) {}
class UpdateInstrumentDto extends zodDto(UpdateInstrumentSchema) {}

/** The instruments an admin added (issue #166), for everyone's pickers and team lists. */
@ApiTags("instruments")
@ApiBearerAuth()
@Controller("instruments")
export class InstrumentsController {
  constructor(private readonly instruments: InstrumentsService) {}

  @Get()
  list(): ReturnType<InstrumentsService["list"]> {
    return this.instruments.list();
  }
}

/** Admin > Instruments. */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/instruments")
@UseGuards(GlobalAdminGuard)
export class AdminInstrumentsController {
  constructor(private readonly instruments: InstrumentsService) {}

  @Get()
  list(): ReturnType<InstrumentsService["adminList"]> {
    return this.instruments.adminList();
  }

  @Post()
  create(@Body() dto: CreateInstrumentDto): ReturnType<InstrumentsService["create"]> {
    return this.instruments.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateInstrumentDto): ReturnType<InstrumentsService["update"]> {
    return this.instruments.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string): Promise<void> {
    return this.instruments.remove(id);
  }
}
