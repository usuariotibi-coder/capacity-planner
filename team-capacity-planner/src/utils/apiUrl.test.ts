import { describe, it, expect, afterEach, vi } from 'vitest';

// API_BASE_URL is computed once at module load from import.meta.env.VITE_API_URL,
// so each scenario needs a fresh module instance with a stubbed env value.
// Note: the local .env always defines VITE_API_URL, so "unset" is simulated
// with an empty string rather than a true absence of the variable.
const loadApiUrl = async (value: string) => {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', value);
  return import('./apiUrl');
};

describe('API_BASE_URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('falls back to the production URL when VITE_API_URL is empty', async () => {
    const { API_BASE_URL, API_FALLBACK_BASE_URL } = await loadApiUrl('');
    expect(API_BASE_URL).toBe(API_FALLBACK_BASE_URL);
  });

  it('accepts a bare host and adds https', async () => {
    const { API_BASE_URL } = await loadApiUrl('api.example.com');
    expect(API_BASE_URL).toBe('https://api.example.com');
  });

  it('strips a trailing /api suffix', async () => {
    const { API_BASE_URL } = await loadApiUrl('https://api.example.com/api');
    expect(API_BASE_URL).toBe('https://api.example.com');
  });

  it('strips trailing slashes', async () => {
    const { API_BASE_URL } = await loadApiUrl('https://api.example.com/');
    expect(API_BASE_URL).toBe('https://api.example.com');
  });

  it('falls back when the hostname contains an underscore (invalid DNS name)', async () => {
    const { API_BASE_URL, API_FALLBACK_BASE_URL } = await loadApiUrl('https://invalid_host.example.com');
    expect(API_BASE_URL).toBe(API_FALLBACK_BASE_URL);
  });

  it('falls back on an unparseable URL', async () => {
    const { API_BASE_URL, API_FALLBACK_BASE_URL } = await loadApiUrl('http://');
    expect(API_BASE_URL).toBe(API_FALLBACK_BASE_URL);
  });
});
