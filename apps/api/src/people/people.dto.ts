import { ConnectionRequestSchema, ShareSchema } from "@oneverse/core";
import { zodDto } from "../common/zod-validation.js";

export class ConnectionRequestDto extends zodDto(ConnectionRequestSchema) {}

export class ShareDto extends zodDto(ShareSchema) {}
