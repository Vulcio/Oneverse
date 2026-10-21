import { OfflineSyncSchema, OfflinePinSchema, OfflineSongsSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export { PIN_KINDS, type PinKind } from "@oneverse/core";

export class OfflineSyncDto extends zodDto(OfflineSyncSchema) {}

export class OfflinePinDto extends zodDto(OfflinePinSchema) {}

export class OfflineSongsDto extends zodDto(OfflineSongsSchema) {}
