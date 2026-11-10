# @oneverse/ui

The UI primitives shared by Songverse's web app and Planiverse (issue #241):
Base UI components styled with Tailwind, in the shadcn manner, the `cn`
helper, a few hooks, and the shared theme.

Source only, no build: an app imports the files and compiles them.

```tsx
import { Button } from "@oneverse/ui/components/button";
import { cn } from "@oneverse/ui/lib/utils";
```

```css
@import "tailwindcss";
@import "@oneverse/ui/theme.css"; /* tokens, @theme, base styles; scans this package for its classes */
/* then the app's own looks, overriding the tokens */
```

## The rules

**Base UI, never Radix.** A component here is built on `@base-ui/react`, in
shadcn's manner (its part names, `data-slot`, variants with `cva`). When
shadcn's version of a component needs a library that brings `@radix-ui/*`
along (`cmdk` does), write it on Base UI instead, as
`command.tsx` and `toast.tsx` are. Check a new dependency's own dependencies
before adding it.

**One way to show each state** (issue #425). Use the component, not classes
of your own, so the apps look and read the same everywhere:

| What is happening | Use | Not |
| --- | --- | --- |
| A button is working | `<Spinner />` in the button, the button disabled | `Loader2` with `animate-spin` |
| A list or card is loading | `Skeleton` in the shape of what comes | the word "Loading…" alone |
| Nothing there yet, nothing found | `Empty` (`variant="card"` when it stands for a card) | a paragraph with paddings of its own |
| A form or a field went wrong | `FieldError` under it (announced, nothing while there is none) | `<p className="text-destructive">` |
| Something to know that stays true | `Alert` (`warning`, `destructive`, `success`), in the page | a bordered `div` in amber or red |
| It worked, and that is all | `toast.success("Saved")`, or the button saying so ("Copied") | a line that stays in the page |
| It failed, away from any form | `toast.error(message)` | `alert()` |
| A key to press | `Kbd` | a styled `<kbd>` |
| Finding and picking with the keyboard | `Command` and its parts | a list with its own arrow keys |
| A label, a control, its help and error | `Field`, `FieldLabel`, `FieldDescription`, `FieldError` | divs with gaps of their own |

**Colours come from the tokens.** `text-destructive`, `text-warning`,
`text-success` and their tints (`bg-warning/10`, `border-warning/40`) say
"wrong", "mind this" and "fine", in light and dark. Tailwind's palette
(`amber-500`, `emerald-500`) is for colours that mean something of their own:
a section's colour, a note's, the tuner's needle.

**An app's toasts** show where it puts `AppToaster` (`@oneverse/app`), once,
inside its language provider.
