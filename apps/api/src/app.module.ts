import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { AdminModule } from "./admin/admin.module.js";
import { ArrangementsModule } from "./arrangements/arrangements.module.js";
import { AccessModule } from "./access/access.module.js";
import { AppController } from "./app.controller.js";
import { AttachmentsModule } from "./attachments/attachments.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { BulkUploadModule } from "./bulk-upload/bulk-upload.module.js";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard.js";
import { RateLimitGuard } from "./security/rate-limit.guard.js";
import { SecurityController } from "./security/security.controller.js";
import { StemSeparationModule } from "./stem-separation/stem-separation.module.js";
import { InstrumentsModule } from "./instruments/instruments.module.js";
import { NotesModule } from "./notes/notes.module.js";
import { RolesModule } from "./roles/roles.module.js";
import { UploadsModule } from "./uploads/uploads.module.js";
import { MusicBrainzModule } from "./musicbrainz/musicbrainz.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { SongbookCatalogModule } from "./songbook-catalog/songbook-catalog.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { OfflineModule } from "./offline/offline.module.js";
import { SetlistsModule } from "./setlists/setlists.module.js";
import { SongbooksModule } from "./songbooks/songbooks.module.js";
import { SongVersionsModule } from "./song-versions/song-versions.module.js";
import { TagsModule } from "./tags/tags.module.js";
import { SmartListsModule } from "./smart-lists/smart-lists.module.js";
import { TeamEventsModule } from "./team-events/team-events.module.js";
import { TeamsModule } from "./teams/teams.module.js";
import { OrganizationsModule } from "./organizations/organizations.module.js";
import { UsersModule } from "./users/users.module.js";
import { WorksModule } from "./works/works.module.js";
import { PublishingModule } from "./publishing/publishing.module.js";
import { SuggestionsModule } from "./suggestions/suggestions.module.js";
import { SyncModule } from "./sync/sync.module.js";
import { ScreensModule } from "./screens/screens.module.js";
import { ScripturesModule } from "./scriptures/scriptures.module.js";
import { BrandsModule } from "./brands/brands.module.js";
import { InvitationsModule } from "./invitations/invitations.module.js";
import { PeopleModule } from "./people/people.module.js";
import { LibraryHomeModule } from "./library-home/library-home.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { LookupsModule } from "./lookups/lookups.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>("REDIS_URL") },
      }),
    }),
    PrismaModule,
    AccessModule,
    JobsModule,
    LookupsModule,
    AuthModule,
    UsersModule,
    TeamsModule,
    OrganizationsModule,
    TeamEventsModule,
    NotificationsModule,
    WorksModule,
    SongVersionsModule,
    ArrangementsModule,
    SongbooksModule,
    SetlistsModule,
    OfflineModule,
    SongbookCatalogModule,
    TagsModule,
    SmartListsModule,
    MusicBrainzModule,
    AttachmentsModule,
    BulkUploadModule,
    AdminModule,
    PublishingModule,
    SuggestionsModule,
    PeopleModule,
    SyncModule,
    ScreensModule,
    ScripturesModule,
    BrandsModule,
    InvitationsModule,
    LibraryHomeModule,
    StemSeparationModule,
    RolesModule,
    InstrumentsModule,
    NotesModule,
    UploadsModule,
  ],
  controllers: [AppController, SecurityController],
  providers: [
    // JwtAuthGuard runs on every route by default; opt out with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Then the rate limits (issue #113): after it, so a signed-in user is counted as themselves.
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
