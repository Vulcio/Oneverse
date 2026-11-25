import { TeamInvitationSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class TeamInvitationDto extends zodDto(TeamInvitationSchema) {}
