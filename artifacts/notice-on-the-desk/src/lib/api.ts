import type {
  AnalysisResult,
  AnalyseRequest,
  ApiError as ApiErrorBody,
  BenchResults,
  ExtractResponse,
} from "@/types/analysis";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, code?: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = (await response.json()) as Partial<ApiErrorBody>;
    } catch {
      // Keep a useful HTTP error when the service does not return JSON.
    }
    const retryHeader = response.headers.get("Retry-After");
    const retryAfterSeconds = retryHeader ? Number(retryHeader) : undefined;
    const message = body.error || `The analysis service returned ${response.status}.`;
    throw new ApiError(message, response.status, body.code, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined);
  }
  return (await response.json()) as T;
}

function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

async function request(path: string, init?: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(apiUrl(path), { cache: "no-store", ...init, signal: controller.signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw new ApiError("The request took too long. Please try again.", 0, "request_timeout");
    }
    throw new ApiError("The analysis service is unreachable. Check the backend URL and that the service is running.", 0, "unreachable");
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function analyse(body: AnalyseRequest): Promise<AnalysisResult> {
  const response = await request("/api/analyse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return responseJson<AnalysisResult>(response);
}

export async function extractFiles(files: File[]): Promise<ExtractResponse> {
  const formData = new FormData();
  for (const file of files) formData.append("file", file);
  const response = await request("/api/extract", { method: "POST", body: formData }, 60_000);
  return responseJson<ExtractResponse>(response);
}

export async function extractFile(file: File): Promise<ExtractResponse> {
  return extractFiles([file]);
}

export async function getBench(): Promise<BenchResults> {
  const response = await request("/api/bench");
  return responseJson<BenchResults>(response);
}

export async function getHealth(): Promise<{ ok: boolean; ai: false; engine: string; imageReading: string }> {
  const response = await request("/api/health");
  return responseJson<{ ok: boolean; ai: false; engine: string; imageReading: string }>(response);
}
