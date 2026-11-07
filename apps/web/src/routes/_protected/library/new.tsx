import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SongEditor } from "#/components/song-editor/song-editor";
import { apiClient } from "#/lib/api-client";
import { takeHandedOver } from "#/lib/incoming";
import { parseSongSearch } from "./-song-search";

export const Route = createFileRoute("/_protected/library/new")({
  validateSearch: parseSongSearch,
  loaderDeps: ({ search }) => ({ linkTo: search.linkTo }),
  loader: async ({ deps }) => ({
    tags: await apiClient.listTags(),
    // "Add a translation" on a song (issue #78): this one is linked to it.
    linkTo: deps.linkTo ? await apiClient.getSongVersion(deps.linkTo).catch(() => null) : null,
  }),
  component: NewSong,
});

function NewSong() {
  const { tags, linkTo } = Route.useLoaderData();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  // From the Import page (issue #407): what was shared or opened, as its chart.
  const [incoming] = useState(takeHandedOver);
  return (
    <SongEditor
      mode="create"
      incoming={incoming}
      tags={tags}
      linkTo={linkTo ? { id: linkTo.id, label: linkTo.title } : undefined}
      tab={tab ?? "info"}
      onTabChange={(next) => void navigate({ search: { tab: next === "info" ? undefined : next }, replace: true })}
    />
  );
}
