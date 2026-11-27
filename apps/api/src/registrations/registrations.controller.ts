import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { isCalendarDate, type EventRegistration, type MyRegistration, type PublicRegistrationPage, type RegistrationEntry, type RegistrationForm, type RegistrationList } from "@oneverse/core";
import { Public } from "../common/decorators/public.decorator.js";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { ManageRegistrationDto, RegisterDto, RegistrationFormDto, RegistrationFormQueryDto, UpdateRegistrationDto } from "./dto/registrations.dto.js";
import { RegistrationsService } from "./registrations.service.js";

function checkDate(date: string): string {
  if (!isCalendarDate(date)) throw new BadRequestException(["date must be a date, YYYY-MM-DD"]);
  return date;
}

/**
 * Registration for event dates (issue #593), for those who manage it: an
 * event's form, each date's list (and its CSV), marking paid and
 * cancelling. A member signed in registers here too, tied to their account.
 */
@ApiTags("registrations")
@ApiBearerAuth()
@Controller()
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Get("registration-forms")
  @ApiOkResponse({ description: "The event's registration (null when it's off), and whether the viewer manages it. A group's part of an organisation's event answers the organisation's event's." })
  get(@SignedIn() user: AuthenticatedUser, @Query() query: RegistrationFormQueryDto): Promise<EventRegistration & { organizationEventId: string | null }> {
    return this.registrations.get(user, query);
  }

  @Put("registration-forms")
  save(@SignedIn() user: AuthenticatedUser, @Body() dto: RegistrationFormDto): Promise<RegistrationForm> {
    return this.registrations.save(user, dto);
  }

  @Delete("registration-forms/:formId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@SignedIn() user: AuthenticatedUser, @Param("formId") formId: string): Promise<void> {
    return this.registrations.remove(user, formId);
  }

  @Get("registration-forms/:formId/dates/:date")
  list(@SignedIn() user: AuthenticatedUser, @Param("formId") formId: string, @Param("date") date: string): Promise<RegistrationList> {
    return this.registrations.list(user, formId, checkDate(date));
  }

  @Get("registration-forms/:formId/dates/:date/export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="registrations.csv"')
  export(@SignedIn() user: AuthenticatedUser, @Param("formId") formId: string, @Param("date") date: string): Promise<string> {
    return this.registrations.csv(user, formId, checkDate(date));
  }

  @Patch("registrations/:registrationId")
  manage(@SignedIn() user: AuthenticatedUser, @Param("registrationId") registrationId: string, @Body() dto: ManageRegistrationDto): Promise<RegistrationEntry> {
    return this.registrations.manage(user, registrationId, dto);
  }

  @Post("registrations/:publicId/:date")
  @RateLimit("heavy")
  registerSignedIn(@SignedIn() user: AuthenticatedUser, @Param("publicId") publicId: string, @Param("date") date: string, @Body() dto: RegisterDto): Promise<MyRegistration> {
    return this.registrations.register(publicId, checkDate(date), dto, user.id);
  }
}

/**
 * The public side (issue #593): the registration page anyone with its link
 * opens, registering without an account, and the link in a registration's
 * emails, which opens it to see, change or cancel.
 */
@ApiTags("registrations")
@Controller("public")
export class PublicRegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Public()
  @Get("registrations/:publicId")
  page(@Param("publicId") publicId: string): Promise<PublicRegistrationPage> {
    return this.registrations.page(publicId);
  }

  @Public()
  @RateLimit("heavy")
  @Post("registrations/:publicId/:date")
  @ApiOkResponse({ description: "Its token opens it later (the link in its email). 409 REGISTRATION_FULL without a waiting list, REGISTRATION_CLOSED or REGISTRATION_NOT_OPEN_YET." })
  register(@Param("publicId") publicId: string, @Param("date") date: string, @Body() dto: RegisterDto): Promise<MyRegistration> {
    return this.registrations.register(publicId, checkDate(date), dto, null);
  }

  @Public()
  @Get("registration/:token")
  mine(@Param("token") token: string): Promise<MyRegistration> {
    return this.registrations.getMine(token);
  }

  @Public()
  @RateLimit("heavy")
  @Patch("registration/:token")
  update(@Param("token") token: string, @Body() dto: UpdateRegistrationDto): Promise<MyRegistration> {
    return this.registrations.update(token, dto);
  }

  @Public()
  @Post("registration/:token/cancel")
  @HttpCode(HttpStatus.OK)
  cancel(@Param("token") token: string): Promise<MyRegistration> {
    return this.registrations.cancelMine(token);
  }
}
