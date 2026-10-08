import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Changing this (e.g. the current path) clears the error, so navigating away recovers. */
  resetKey?: unknown;
  /** Smaller card for a single section instead of a whole page. */
  compact?: boolean;
}

interface State {
  error: Error | null;
}

/**
 * Keeps one broken page or card from blanking the whole app. Shows a friendly
 * message with "Try again" instead of a white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[NetSentinel] UI error", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className={`rounded-[26px] bg-white shadow-card ${this.props.compact ? "p-5" : "mx-auto mt-6 max-w-xl p-8 text-center"}`}
      >
        <div className={`flex ${this.props.compact ? "items-start gap-3" : "flex-col items-center gap-3"}`}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-beige text-brand-orange-ink">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-stone-900">This part of the page hit a problem</h2>
            <p className="mt-1 text-sm text-stone-600">
              The rest of NetSentinel is still running and monitoring continues in the background.
            </p>
            <p className="mt-2 break-words font-mono text-xs text-stone-500">{this.state.error.message}</p>
            <div className={`mt-4 flex gap-2 ${this.props.compact ? "" : "justify-center"}`}>
              <button
                onClick={() => this.setState({ error: null })}
                className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-soft"
              >
                <RotateCcw className="h-4 w-4" /> Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
