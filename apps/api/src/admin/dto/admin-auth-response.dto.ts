import { ApiProperty } from "@nestjs/swagger";

const AUTH_SOURCES = ["database", "env", "none"] as const;

export class AuthConfigResponseDto {
  @ApiProperty({ enum: AUTH_SOURCES, description: "Where the active email config came from" })
  emailSource!: (typeof AUTH_SOURCES)[number];
  @ApiProperty() emailFrom!: string;
  @ApiProperty({ enum: ["resend", "smtp"], description: "How email goes out (issue #38)" })
  emailProvider!: "resend" | "smtp";
  @ApiProperty({ description: "Whether mail is sent (else only logged)" }) emailConfigured!: boolean;
  @ApiProperty() hasDatabaseResendKey!: boolean;
  @ApiProperty({ required: false, nullable: true }) smtpHost!: string | null;
  @ApiProperty({ required: false, nullable: true }) smtpPort!: number | null;
  @ApiProperty({ required: false, nullable: true }) smtpSecure!: boolean | null;
  @ApiProperty({ required: false, nullable: true }) smtpUser!: string | null;
  @ApiProperty() hasDatabaseSmtpPassword!: boolean;
  @ApiProperty({ enum: AUTH_SOURCES, description: "Where the active Google OAuth config came from" })
  googleSource!: (typeof AUTH_SOURCES)[number];
  @ApiProperty({ required: false, nullable: true }) googleClientId!: string | null;
  @ApiProperty() hasDatabaseGoogleSecret!: boolean;
}
