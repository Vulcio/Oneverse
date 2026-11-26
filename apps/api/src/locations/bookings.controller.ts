import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AskBookingSchema, BookingRequestsQuerySchema } from "@oneverse/core";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { zodDto } from "../common/zod-validation.js";
import { BookingsService } from "./bookings.service.js";

class AskBookingDto extends zodDto(AskBookingSchema) {}
class BookingRequestsQueryDto extends zodDto(BookingRequestsQuerySchema) {}

/** Bookings between people (issue #565): asking for a room or resource, and approving bookings. */
@ApiTags("bookings")
@ApiBearerAuth()
@Controller("bookings")
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post("ask")
  @ApiOperation({ summary: "Asks an event to free a room or resource", description: "Its organisers are told who asks, for what and which date, with the message. Answers how many were told." })
  ask(@Body() dto: AskBookingDto, @SignedIn() user: AuthenticatedUser): ReturnType<BookingsService["ask"]> {
    return this.bookings.ask(user, dto);
  }

  @Get("requests")
  @ApiOperation({ summary: "Bookings waiting for the user's approval", description: "Of the rooms and resources they manage; `teamId` or `organizationId`: only that one's." })
  requests(@Query() query: BookingRequestsQueryDto, @SignedIn() user: AuthenticatedUser): ReturnType<BookingsService["requests"]> {
    return this.bookings.requests(user, query);
  }

  @Post("requests/:approvalId/approve")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Approves a booking", description: "By one of the room's or resource's managers; whoever asked is told." })
  approve(@Param("approvalId") approvalId: string, @SignedIn() user: AuthenticatedUser): Promise<void> {
    return this.bookings.approve(user, approvalId);
  }

  @Post("requests/:approvalId/decline")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Declines a booking", description: "By one of its managers: the event gives the room or resource up; whoever asked is told." })
  decline(@Param("approvalId") approvalId: string, @SignedIn() user: AuthenticatedUser): Promise<void> {
    return this.bookings.decline(user, approvalId);
  }
}
