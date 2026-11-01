import { ApiProperty } from "@nestjs/swagger";
import { DISPLAY_MODES, CAPO_DISPLAY_MODES, CHORD_DIAGRAMS, PIANO_HANDS, PIANO_NOTE_NAMES, CHORD_NOTATIONS, LIVE_VIEWS, VOICING_PREFERENCES, SUPPORTED_LOCALES, TECH_ROLES } from "@oneverse/core";

export class UserResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ required: false, nullable: true }) avatarUrl!: string | null;
  @ApiProperty({ enum: SUPPORTED_LOCALES }) locale!: (typeof SUPPORTED_LOCALES)[number];
  @ApiProperty({ enum: DISPLAY_MODES }) displayMode!: (typeof DISPLAY_MODES)[number];
  @ApiProperty({ enum: CAPO_DISPLAY_MODES }) capoDisplayMode!: (typeof CAPO_DISPLAY_MODES)[number];
  @ApiProperty({ enum: CHORD_NOTATIONS }) chordNotation!: (typeof CHORD_NOTATIONS)[number];
  @ApiProperty({ enum: LIVE_VIEWS }) liveView!: (typeof LIVE_VIEWS)[number];
  @ApiProperty({ enum: CHORD_DIAGRAMS, description: "Chord diagrams beside charts (issue #207)" }) chordDiagrams!: (typeof CHORD_DIAGRAMS)[number];
  @ApiProperty({ description: "Chords coloured by family (issue #9)" }) chordColors!: boolean;
  @ApiProperty({ description: "Chord diagrams mirrored for a left-handed player (issue #207)" }) leftHanded!: boolean;
  @ApiProperty({ description: "Calendars' first day of the week (issue #235): 0 Sunday, 1 Monday, 6 Saturday; null from the language", nullable: true, type: Number }) weekStartsOn!: number | null;
  @ApiProperty({ description: "The guitar's tuning: one of TUNINGS.guitar's ids in core" }) guitarTuning!: string;
  @ApiProperty({ description: "The ukulele's tuning: one of TUNINGS.ukulele's ids in core" }) ukuleleTuning!: string;
  @ApiProperty({ description: "Piano diagrams: each chord's inversion nearest the one before (issue #207)" }) pianoSmooth!: boolean;
  @ApiProperty({ enum: PIANO_HANDS }) pianoHands!: string;
  @ApiProperty({ enum: PIANO_NOTE_NAMES }) pianoNoteNames!: string;
  @ApiProperty({ enum: VOICING_PREFERENCES }) voicingPreference!: (typeof VOICING_PREFERENCES)[number];
  @ApiProperty() isGlobalAdmin!: boolean;
  @ApiProperty({ description: "From their roles, or their teams' (issue #160)" }) isReviewer!: boolean;
  @ApiProperty({ description: "From their roles, or their teams'" }) canSeparateStems!: boolean;
  @ApiProperty({ description: "May upload audio files: a role's, or a global admin's. Recording in Songverse needs no role." }) canUploadAudio!: boolean;
  @ApiProperty({ type: [String], description: "Their roles' names, their own and their teams'" }) roles!: string[];
  @ApiProperty({ type: [String], description: "What their roles allow plugins (issue #157)" }) permissions!: string[];
  @ApiProperty({ type: [String], description: "Built-in instruments' keys (INSTRUMENTS), then the ids of those an admin added (issue #166)" }) instruments!: string[];
  @ApiProperty({ enum: TECH_ROLES, isArray: true }) techRoles!: (typeof TECH_ROLES)[number][];
  @ApiProperty({ description: "Ask them what they play or do (issue #109): nothing said yet, not skipped lately" }) askProfile!: boolean;
}
