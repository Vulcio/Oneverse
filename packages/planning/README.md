# @songverse/planning

The planning screens shared by Songverse's web app and Planiverse (issue
#241): a team's calendar (events, answers, line-up, reminders), My
calendar, organisations, their groups, positions and events.

Source only, no build. The app showing them wraps its pages in a
`PlanningProvider` that says what it has:

```tsx
import { PlanningProvider, type PlanningHost } from "@songverse/planning/host";

const host: PlanningHost = {
  api: apiClient, // the app's own (createAppApiClient)
  links: {
    organizations: "/organizations",
    team: (id) => `/teams/${id}`,
    organization: (id) => `/organizations/${id}`,
    organizationEvents: (id) => `/organizations/${id}/events`,
  },
  // Songverse: its sets, made and opened here. An app without sets: null,
  // or another app's address with canMake: false.
  sets: { href: (id) => `/sets/${id}`, canMake: true },
};
```

The app keeps its routes: each loads with the page's loader
(`loadOrganizationPage(api, id)`…) and renders the page
(`@songverse/planning/pages/organization`), the parts in
`@songverse/planning/components/*`.
