import { AddressSuggestionsQuerySchema, DeclineOrganizationRequestSchema, OrganizationSignupSchema, RequestOrganizationSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class RequestOrganizationDto extends zodDto(RequestOrganizationSchema) {}
export class DeclineOrganizationRequestDto extends zodDto(DeclineOrganizationRequestSchema) {}
export class OrganizationSignupDto extends zodDto(OrganizationSignupSchema) {}
export class AddressSuggestionsQueryDto extends zodDto(AddressSuggestionsQuerySchema) {}
