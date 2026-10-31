const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:16453/api/v1";

export type User = {
  id: number;
  email: string;
  full_name: string;
  role: "admin" | "staff" | "customer";
};

export type Row = Record<string, unknown> & { id: number };
export type Dashboard = {
  customers: number;
  active_subscriptions: number;
  revenue_received: number;
  outstanding_revenue: number;
  overdue_invoices: number;
  upcoming_renewals: number;
  recent_payments: Row[];
};
export type ModelTrainingResult = {
  algorithm: string;
  target: string;
  as_of_date: string;
  training_rows: number;
  class_counts: Record<string, number>;
  invoices: { id: number; due_date: string; total: string; status: string }[];
  note: string;
};
export type ModelPredictionResult = {
  predicted_status: string;
  probabilities: Record<string, number>;
  features: Record<string, string>;
  note: string;
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function request<T>(
  path: string,
  token?: string | null,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(`Cannot reach the API at ${API_URL}. Start the backend and check VITE_API_URL.`, 0);
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json() as { detail?: string | { msg?: string }[] };
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail)) message = body.detail.map((item) => item.msg).filter(Boolean).join(", ");
    } catch {
      // Keep the HTTP status message when the server does not return JSON.
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, token: string) => request<T>(path, token),
  post: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, token, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown, token: string) =>
    request<T>(path, token, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string, token: string) => request<T>(path, token, { method: "DELETE" }),
};
