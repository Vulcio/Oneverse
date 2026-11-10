import type { ReactNode } from "react";

/**
 * A signed-out page (sign-in, invitations, a new password): the app's name
 * above what it asks. `actions` sit in the top corner: Oneverse's light or
 * dark choice (issue #422).
 */
export function AuthPage({ brand, actions, children }: { brand: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      {actions ? <div className="absolute top-4 right-4">{actions}</div> : null}
      <div className="flex items-center gap-2 text-lg font-semibold">{brand}</div>
      {children}
    </main>
  );
}
