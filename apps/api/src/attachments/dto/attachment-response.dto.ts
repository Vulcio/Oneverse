import { ApiProperty } from "@nestjs/swagger";
import { STEM_PARTS, type StemPart } from "@songverse/core";

const ATTACHMENT_TYPES = ["PDF", "CHORDPRO", "MUSICXML", "ABC_NOTATION", "TEXT", "IMAGE", "AUDIO", "OTHER"] as const;

export class AttachmentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() songVersionId!: string;
  @ApiProperty({ enum: ATTACHMENT_TYPES }) type!: (typeof ATTACHMENT_TYPES)[number];
  @ApiProperty() filename!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty({ required: false, nullable: true }) sizeBytes!: number | null;
  @ApiProperty({ enum: STEM_PARTS, nullable: true }) stemPart!: StemPart | null;
  @ApiProperty({ nullable: true, description: "Its own name for the part, shown instead of the part's." }) partName!: string | null;
  @ApiProperty({ description: "The viewer uploaded it." }) mine!: boolean;
  @ApiProperty({ nullable: true }) recordingKey!: string | null;
  @ApiProperty({ nullable: true }) recordingTempo!: number | null;
  @ApiProperty({ nullable: true }) recordingFirstBeat!: number | null;
  @ApiProperty({ nullable: true, description: "A lossless upload's original, kept as FLAC beside this Opus copy: GET …/original." }) original!: { mimeType: string; sizeBytes: number | null } | null;
  @ApiProperty({ type: [Number], description: "The recording's beats, in seconds (issue #299), as the stem separation's analysis found them; empty for none." }) recordingBeats!: number[];
  @ApiProperty({ type: [Number], description: "The first beat of each of its bars, in seconds: a subset of recordingBeats." }) recordingDownbeats!: number[];
  @ApiProperty({ description: "Played freely before its first beat: the click waits for it, with a count-in, rather than clicking from 0:00." }) recordingFreeIntro!: boolean;
  @ApiProperty({ nullable: true, description: "Recorded this many semitones above its multitrack, while the player was transposed." }) pitchOffset!: number | null;
  @ApiProperty({ nullable: true, description: '"4/4", "6/8"…' }) recordingTimeSignature!: string | null;
  @ApiProperty({ nullable: true, description: "The multitrack it's part of (files recorded together); null for the song's original stems." }) multitrackId!: string | null;
  @ApiProperty({ nullable: true }) multitrackName!: string | null;
  @ApiProperty({ nullable: true, description: "The set its multitrack was recorded for." }) multitrackSetlistId!: string | null;
  @ApiProperty({ nullable: true, description: "That set: its id, name and date (YYYY-MM-DD)." }) multitrackSetlist!: { id: string; name: string | null; eventDate: string | null } | null;
  @ApiProperty({ description: "Another take of its part, kept but not played." }) otherTake!: boolean;
  @ApiProperty({ enum: ["PENDING", "FAILED"], nullable: true, description: "A recorded take being turned into Opus, or that couldn't be; null once done." }) processing!: "PENDING" | "FAILED" | null;
  @ApiProperty({ enum: ["PRIVATE", "TEAM", "SONG", "SHARED"] }) visibility!: "PRIVATE" | "TEAM" | "SONG" | "SHARED";
  @ApiProperty({ nullable: true }) visibleToTeamId!: string | null;
  @ApiProperty({ nullable: true }) uploadedByUserId!: string | null;
  @ApiProperty({ description: "May change its part, key and tempo, or remove it." }) canChange!: boolean;
  @ApiProperty({ description: "May change who sees it." }) canChangeVisibility!: boolean;
  @ApiProperty() createdAt!: Date;
}
