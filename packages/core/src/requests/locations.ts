import "../zod-config.js";
import { z } from "zod";
import { isTimeZone } from "../calendar/index.js";
import { clearableText, optional, requiredText } from "./fields.js";

/** Where events take place (issue #320): an organisation's or a team's locations. */

const id = z.string().min(1).max(40);
const timeZone = z.string().refine(isTimeZone, "timeZone must be a time zone, like Europe/Paris");

/** POST /locations: a team's location, or an organisation's - for its admins. */
export const CreateLocationSchema = z
  .strictObject({
    name: requiredText(80),
    address: optional(z.string().trim().max(300)),
    timeZone: timeZone.describe("An IANA time zone (Europe/Paris): its events' and what follows it"),
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
});
export type UpdateLocationRequest = z.input<typeof UpdateLocationSchema>;

/** GET /locations: a team's events' (its own and its organisation's), an organisation's, or (nothing given) every location the user can use. */
export const LocationsQuerySchema = z.strictObject({
  teamId: optional(id),
  organizationId: optional(id),
});
