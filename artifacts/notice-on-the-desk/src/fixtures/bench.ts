import type { BenchResults } from "@/types/analysis";

export const sampleBenchResults: BenchResults = {
  generatedAt: "2026-10-24T12:00:00.000Z",
  total: 5,
  handled: 3,
  abstained: 2,
  metrics: {
    evidenceSupportRate: 0.6,
    deadlineCorrectness: 0.4,
    safeAbstentionRate: 0.8,
  },
  cases: [
    {
      id: "bench-gst-stated-date",
      category: "GST sample · stated date",
      pass: true,
      reason: "Sample date was quoted from the notice text.",
      abstained: false,
    },
    {
      id: "bench-cheque-computed-date",
      category: "Cheque sample · computed date",
      pass: false,
      reason: "Demo date arithmetic is not a legal-rule check.",
      abstained: false,
    },
    {
      id: "bench-legal-missing-section",
      category: "Legal sample · missing section",
      pass: true,
      reason: "The absent section was labeled not found.",
      abstained: true,
    },
    {
      id: "bench-unclear-candidates",
      category: "Unclear sample · candidate dates",
      pass: true,
      reason: "The result abstains from selecting one date.",
      abstained: true,
    },
    {
      id: "bench-conflict-candidates",
      category: "Conflict sample · different pages",
      pass: false,
      reason: "Sample data only; no real-world test has been run.",
      abstained: false,
    },
  ],
};
