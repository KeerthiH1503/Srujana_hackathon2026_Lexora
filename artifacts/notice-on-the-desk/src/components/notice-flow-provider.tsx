"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { AnalysisResult, FactOverrides, TextSource } from "@/types/analysis";

export type NoticeFlowState = {
  text: string;
  warnings: string[];
  quality: "good" | "poor";
  isSample: boolean;
  result: AnalysisResult | null;
  previewUrl: string;
  fileName: string;
  fileType: string;
  source: TextSource;
  overrides: FactOverrides;
  lowConfidenceWords: string[];
};

type NoticeFlowContextValue = {
  flow: NoticeFlowState;
  updateFlow: (updates: Partial<NoticeFlowState>) => void;
  clearFlow: () => void;
};

const initialState: NoticeFlowState = {
  text: "",
  warnings: [],
  quality: "good",
  isSample: false,
  result: null,
  previewUrl: "",
  fileName: "",
  fileType: "",
  source: { method: "text" },
  overrides: {},
  lowConfidenceWords: [],
};

const NoticeFlowContext = createContext<NoticeFlowContextValue | null>(null);

export function NoticeFlowProvider({ children }: { children: ReactNode }) {
  const [flow, setFlow] = useState(initialState);
  const value = useMemo<NoticeFlowContextValue>(
    () => ({
      flow,
      updateFlow: (updates) => setFlow((current) => ({ ...current, ...updates })),
      clearFlow: () => setFlow(initialState),
    }),
    [flow],
  );

  return (
    <NoticeFlowContext.Provider value={value}>
      {children}
    </NoticeFlowContext.Provider>
  );
}

export function useNoticeFlow(): NoticeFlowContextValue {
  const value = useContext(NoticeFlowContext);
  if (!value) {
    throw new Error("useNoticeFlow must be used inside NoticeFlowProvider.");
  }
  return value;
}
