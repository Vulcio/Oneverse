import { DeclineOrganizationRequestSchema, RequestOrganizationSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class RequestOrganizationDto extends zodDto(RequestOrganizationSchema) {}
export class DeclineOrganizationRequestDto extends zodDto(DeclineOrganizationRequestSchema) {}
