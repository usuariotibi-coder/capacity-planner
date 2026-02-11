const LEGACY_RAILWAY_API_BASE_URL = 'https://capacity-planner-production.up.railway.app';
const LOCAL_API_BASE_URL = 'http://localhost:8000';

const normalizePath = (pathname: string): string => {
  const trimmed = pathname.replace(/\/+$/, '');
  if (!trimmed || trimmed === '/') return '';
  if (trimmed.toLowerCase() === '/api') return '';
  return trimmed;
};

const isLocalHostname = (hostname: string): boolean => {
  const value = (hostname || '').toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '0.0.0.0' || value === '::1';
};

const getRuntimeDefaultBaseUrl = (): string => {
  if (typeof window === 'undefined') return LEGACY_RAILWAY_API_BASE_URL;

  const { hostname, origin } = window.location;
  if (isLocalHostname(hostname)) return LOCAL_API_BASE_URL;
  return origin;
};

const normalizeBaseUrl = (input?: string): string => {
  if (!input) return LEGACY_RAILWAY_API_BASE_URL;

  const trimmed = input.trim();
  if (!trimmed) return LEGACY_RAILWAY_API_BASE_URL;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    // DNS hostnames cannot contain underscores; if present, the URL will fail to resolve.
    if (parsed.hostname.includes('_')) return LEGACY_RAILWAY_API_BASE_URL;
    return `${parsed.origin}${normalizePath(parsed.pathname)}`;
  } catch {
    return LEGACY_RAILWAY_API_BASE_URL;
  }
};

const runtimeDefaultBaseUrl = getRuntimeDefaultBaseUrl();

export const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_URL || runtimeDefaultBaseUrl);
export const API_FALLBACK_BASE_URL = normalizeBaseUrl(
  import.meta.env.VITE_API_FALLBACK_URL || LEGACY_RAILWAY_API_BASE_URL
);
