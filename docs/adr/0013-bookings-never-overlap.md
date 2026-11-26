# A room or resource is never booked twice at once

Decided 2026-11-24 (#562). Many calendars only warn about a double booking; Oneverse refuses it, from setup to
teardown, and tells the person which event holds the room or resource, with ways to ask its organiser, reschedule
or cancel. A warning is easy to click past, and the clash then surfaces on the day, in front of everyone; a refusal
makes the two sides talk before. Rooms and resources that need it also wait for their manager's approval, a request
holding the slot meanwhile. Resources with a quantity (chairs, microphones) are shared until they run out.

Built 2026-11-26 (#565): a booking isn't a row of its own. It is worked out from the event's dates, as the
calendar is (`apps/api/src/locations/bookings.ts`), and checked inside the transaction that changes the event, so a
refused change leaves nothing behind. An organisation's event books once for all its groups' parts. A series can be
saved with only its free dates (`skipClashes`): its clashing dates are cancelled, not dropped silently.
