# UI components are built on Base UI, never Radix

Decided 2026-11-10. The shared components in `@oneverse/ui` use Base UI; libraries built on Radix (cmdk and the like)
are not added. One headless library keeps behaviour, focus handling and styling consistent across apps.
