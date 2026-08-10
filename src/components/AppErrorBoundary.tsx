import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Club Planner render error", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="fatal-error" role="alert">
          <h1>Не удалось открыть интерфейс</h1>
          <p>{this.state.error.message || "Произошла неизвестная ошибка."}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Перезапустить интерфейс
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}
