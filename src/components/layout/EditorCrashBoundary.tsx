import { Component, type ErrorInfo, type ReactNode } from "react";

type EditorCrashBoundaryProps = {
  children: ReactNode;
  resetKey: string;
};

type EditorCrashBoundaryState = {
  error: Error | null;
};

export class EditorCrashBoundary extends Component<EditorCrashBoundaryProps, EditorCrashBoundaryState> {
  state: EditorCrashBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): EditorCrashBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Editor crashed", error, info.componentStack);
  }

  componentDidUpdate(previousProps: EditorCrashBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="editor-crash" role="alert">
        <div className="editor-crash__title">Editor view crashed</div>
        <div className="editor-crash__message">
          The workspace shell is still running. Select another file or reopen this file to retry.
        </div>
      </div>
    );
  }
}
