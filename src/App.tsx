import { AppCrashBoundary } from "@/app/AppCrashBoundary";
import { DEFAULT_ROUTE } from "@/app/routes";
import { AppShell } from "@/components/layout/AppShell";

export function App() {
  return (
    <AppCrashBoundary>
      <AppShell key={DEFAULT_ROUTE} />
    </AppCrashBoundary>
  );
}
