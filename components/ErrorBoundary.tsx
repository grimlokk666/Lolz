"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  message: string;
  resetKey: number;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "", resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, message: error.message || "Unknown failure" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[MASTER EYE] ErrorBoundary", error, info.componentStack);
  }

  private handleReset = () => {
    this.props.onReset?.();
    this.setState((s) => ({
      hasError: false,
      message: "",
      resetKey: s.resetKey + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-[200px] w-full flex-col items-center justify-center gap-3 border border-red-500/40 bg-black/80 p-6 text-center backdrop-blur-md">
          <AlertTriangle className="h-8 w-8 text-red-400" />
          <div className="font-mono text-xs uppercase tracking-[0.3em] text-red-300">
            {this.props.fallbackTitle ?? "Subsystem Fault"}
          </div>
          <p className="max-w-md font-mono text-[11px] text-red-200/80">
            {this.state.message}
          </p>
          <Button variant="danger" onClick={this.handleReset}>
            Reinitialize Module
          </Button>
        </div>
      );
    }
    return (
      <React.Fragment key={this.state.resetKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}
