# @songverse/ui

The UI primitives shared by Songverse's web app and Planiverse (issue #241):
Base UI components styled with Tailwind, in the shadcn manner, the `cn`
helper, a few hooks, and the shared theme.

Source only, no build: an app imports the files and compiles them.

```tsx
import { Button } from "@songverse/ui/components/button";
import { cn } from "@songverse/ui/lib/utils";
```

```css
@import "tailwindcss";
@import "@songverse/ui/theme.css"; /* tokens, @theme, base styles; scans this package for its classes */
/* then the app's own looks, overriding the tokens */
```
