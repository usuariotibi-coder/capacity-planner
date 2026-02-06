const FALLBACK_API_BASE_URL = 'https://capacity-planner-production.up.railway.app';

const normalizeBaseUrl = (input?: string): string => {
  if (!input) return FALLBACK_API_BASE_URL;

  const trimmed = input.trim();
  if (!trimmed) return FALLBACK_API_BASE_URL;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    // DNS hostnames cannot contain underscores; if present, the URL will fail to resolve.
    if (parsed.hostname.includes('_')) return FALLBACK_API_BASE_URL;
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return FALLBACK_API_BASE_URL;
  }
};

export const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_URL);
export const API_FALLBACK_BASE_URL = FALLBACK_API_BASE_URL;
