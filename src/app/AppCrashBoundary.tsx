import { Component, type ErrorInfo, type ReactNode } from "react";

type AppCrashBoundaryProps = {
  children: ReactNode;
};

type AppCrashBoundaryState = {
  error: Error | null;
};

export class AppCrashBoundary extends Component<AppCrashBoundaryProps, AppCrashBoundaryState> {
  state: AppCrashBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppCrashBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App shell crashed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="app-crash" role="alert">
        <div className="app-crash__panel">
          <h1>ArkLine hit a UI error</h1>
          <p>The app shell is still loaded. Restart the app window if the workspace does not recover.</p>
          <pre>{this.state.error.message}</pre>
        </div>
      </main>
    );
  }
}
