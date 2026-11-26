import "../zod-config.js";
import { z } from "zod";
import { isTimeZone } from "../calendar/index.js";
import { clearableInt, clearableText, optional, requiredText } from "./fields.js";

/** Where events take place (issue #320): an organisation's or a team's locations. */

const id = z.string().min(1).max(40);
const timeZone = z.string().refine(isTimeZone, "timeZone must be a time zone, like Europe/Paris");

/** POST /locations: a team's location, or an organisation's - for its admins. */
export const CreateLocationSchema = z
  .strictObject({
    name: requiredText(80),
    address: optional(z.string().trim().max(300)),
    timeZone: timeZone.describe("An IANA time zone (Europe/Paris): its events' and what follows it"),
    home: optional(z.boolean()).describe("At someone's home (issue #563): its address only for those who see its events"),
    teamId: optional(id),
    organizationId: optional(id),
  })
  .refine((location) => !!location.teamId !== !!location.organizationId, "A location belongs to a team or an organisation: give teamId or organizationId");
export type CreateLocationRequest = z.input<typeof CreateLocationSchema>;

/** PATCH /locations/:id: a field left out keeps its value; address null (or "") clears it. */
export const UpdateLocationSchema = z.strictObject({
  name: optional(requiredText(80)),
  address: clearableText(300),
  timeZone: optional(timeZone),
  home: optional(z.boolean()),
});
export type UpdateLocationRequest = z.input<typeof UpdateLocationSchema>;

/** GET /locations: a team's events' (its own and its organisation's), an organisation's, or (nothing given) every location the user can use. */
export const LocationsQuerySchema = z.strictObject({
  teamId: optional(id),
  organizationId: optional(id),
});

const minutes = z.number().int().min(0).max(24 * 60);

/** POST /locations/:id/rooms (issue #563): a room of a venue, by its owner's admins. */
export const CreateRoomSchema = z.strictObject({
  name: requiredText(80),
  capacity: optional(z.number().int().min(1).max(100000)),
  setupMinutes: optional(minutes).describe("Held this long before an event, by default"),
  teardownMinutes: optional(minutes).describe("Held this long after an event, by default"),
  needsApproval: optional(z.boolean()).describe("Its bookings wait for a manager's approval (issue #565)"),
  managerTeamId: id.nullable().optional().describe("The team whose admins approve its bookings (a Facilities team, in its owner's organisation); null or left out: its owner's admins"),
});
export type CreateRoomRequest = z.input<typeof CreateRoomSchema>;

/** PATCH /locations/:id/rooms/:roomId: a field left out keeps its value; capacity null clears it. */
export const UpdateRoomSchema = z.strictObject({
  name: optional(requiredText(80)),
  capacity: clearableInt(1, 100000),
  setupMinutes: optional(minutes),
  teardownMinutes: optional(minutes),
  needsApproval: optional(z.boolean()).describe("Its bookings wait for a manager's approval (issue #565)"),
  managerTeamId: id.nullable().optional().describe("The team whose admins approve its bookings (a Facilities team, in its owner's organisation); null or left out: its owner's admins"),
});
export type UpdateRoomRequest = z.input<typeof UpdateRoomSchema>;

/** POST /resources (issue #564): something a team (`teamId`) or an organisation (`organizationId`) owns that events book. */
export const CreateResourceSchema = z
  .strictObject({
    name: requiredText(80),
    quantity: optional(z.number().int().min(1).max(1000)).describe("How many there are; 1 when left out"),
    locationId: optional(id).describe("The venue it's kept at: one of its owner's"),
    needsApproval: optional(z.boolean()).describe("Its bookings wait for a manager's approval (issue #565)"),
    managerTeamId: id.nullable().optional().describe("The team whose admins approve its bookings (a Facilities team, in its owner's organisation); null or left out: its owner's admins"),
    teamId: optional(id),
    organizationId: optional(id),
  })
  .refine((value) => !!value.teamId !== !!value.organizationId, "A resource belongs to a team or an organisation: give teamId or organizationId");
export type CreateResourceRequest = z.input<typeof CreateResourceSchema>;

/** PATCH /resources/:id: a field left out keeps its value; locationId null clears it. */
export const UpdateResourceSchema = z.strictObject({
  name: optional(requiredText(80)),
  quantity: optional(z.number().int().min(1).max(1000)),
  locationId: id.nullable().optional(),
  needsApproval: optional(z.boolean()).describe("Its bookings wait for a manager's approval (issue #565)"),
  managerTeamId: id.nullable().optional().describe("The team whose admins approve its bookings (a Facilities team, in its owner's organisation); null or left out: its owner's admins"),
});
export type UpdateResourceRequest = z.input<typeof UpdateResourceSchema>;

/** GET /resources: a team's (its own and its organisation's), an organisation's, or every one the user can use. */
export const ResourcesQuerySchema = LocationsQuerySchema;

/** The resources an event or an event type takes (issue #564), and how many of each. */
export const EventResourcesSchema = z
  .array(z.strictObject({ resourceId: id, quantity: optional(z.number().int().min(1).max(1000)) }))
  .max(30)
  .describe("Resources it takes (issue #564): its owner's, or its organisation's; [] takes none");

/**
 * POST /bookings/ask (issue #565): someone whose event clashes asks the
 * holding event's organisers to free a room or resource on a date.
 */
export const AskBookingSchema = z.strictObject({
  eventId: id.describe("The event holding it"),
  eventKind: z.enum(["team", "organization"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  kind: z.enum(["room", "resource"]),
  id: id.describe("The room's or resource's"),
  message: optional(z.string().trim().max(500)),
});
export type AskBookingRequest = z.input<typeof AskBookingSchema>;

/** GET /bookings/requests: the bookings waiting for the user's approval, maybe only a team's or an organisation's rooms and resources. */
export const BookingRequestsQuerySchema = LocationsQuerySchema;
