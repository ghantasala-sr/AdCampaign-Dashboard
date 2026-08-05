import type {
  ApiErrorBody,
  Campaign,
  CampaignDetailResponse,
  CampaignListResponse,
  CreateCampaignInput,
  FacetsResponse,
} from '@adsight/types';

/**
 * Thin fetch layer. No caching, no retries, no state — React Query owns all of
 * that. This module's only jobs are building URLs and turning a non-2xx response
 * into a typed error the UI can read field messages out of.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fields?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    // A network failure is the one case with no response to read, and the most
    // common one in local dev (API not running). Say so plainly.
    throw new ApiError(
      `Could not reach the API at ${API_BASE}. Is it running?`,
      0,
      'NETWORK_ERROR',
    );
  }

  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Non-JSON error body; fall through to the status-based message.
    }
    throw new ApiError(
      body?.error.message ?? `Request failed with status ${response.status}`,
      response.status,
      body?.error.code ?? 'UNKNOWN',
      body?.error.fields,
    );
  }

  return (await response.json()) as T;
}

export function fetchCampaigns(
  queryString: string,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<CampaignListResponse> {
  const params = new URLSearchParams(queryString);
  params.set('offset', String(offset));
  params.set('limit', String(limit));
  return request<CampaignListResponse>(`/api/campaigns?${params.toString()}`, { signal });
}

export function fetchCampaignDetail(
  id: string,
  queryString: string,
  signal?: AbortSignal,
): Promise<CampaignDetailResponse> {
  return request<CampaignDetailResponse>(
    `/api/campaigns/${encodeURIComponent(id)}?${queryString}`,
    { signal },
  );
}

export interface FacetsWithWindow extends FacetsResponse {
  readonly dataWindow: { readonly start: string; readonly end: string };
}

export function fetchFacets(signal?: AbortSignal): Promise<FacetsWithWindow> {
  return request<FacetsWithWindow>('/api/facets', { signal });
}

export function createCampaign(input: CreateCampaignInput): Promise<{ campaign: Campaign }> {
  return request<{ campaign: Campaign }>('/api/campaigns', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function fetchAiStatus(
  signal?: AbortSignal,
): Promise<{ source: 'model' | 'heuristic'; model: string | null }> {
  return request<{ source: 'model' | 'heuristic'; model: string | null }>('/api/ai/status', {
    signal,
  });
}
