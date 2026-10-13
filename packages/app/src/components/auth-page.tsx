import type { ReactNode } from "react";

/** A signed-out page (sign-in, invitations, a new password): the app's name above what it asks. */
export function AuthPage({ brand, children }: { brand: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="flex items-center gap-2 text-lg font-semibold">{brand}</div>
      {children}
    </main>
  );
}
