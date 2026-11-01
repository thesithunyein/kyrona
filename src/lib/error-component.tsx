import type { ErrorComponentProps } from "@tanstack/react-router";
import { plainError } from "@/lib/kyrona/engine";

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-fg">
      <h1 className="display text-3xl">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted">{plainError(error)}</p>
    </main>
  );
}