/**
 * PSS06 - Client for the Python AI service.
 *
 * The React app never talks to FastAPI directly; every call is proxied through
 * here so authentication, validation, persistence and rate limiting all stay
 * in one place.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const AI_BASE_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 120000);

class AiServiceError extends Error {
  constructor(message, status = 502, detail = null) {
    super(message);
    this.name = 'AiServiceError';
    this.status = status;
    this.detail = detail;
  }
}

async function request(pathname, { method = 'GET', body = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const res = await fetch(`${AI_BASE_URL}${pathname}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    const text = await res.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { detail: text };
    }

    if (!res.ok) {
      throw new AiServiceError(
        payload.detail || `AI service returned ${res.status}`,
        res.status,
        payload
      );
    }
    return payload;
  } catch (err) {
    if (err instanceof AiServiceError) throw err;
    if (err.name === 'AbortError') {
      throw new AiServiceError('The AI service timed out.', 504);
    }
    throw new AiServiceError(
      `Cannot reach the AI service at ${AI_BASE_URL}. Is it running? (${err.message})`,
      503
    );
  } finally {
    clearTimeout(timer);
  }
}

export const aiService = {
  baseUrl: AI_BASE_URL,

  health: () => request('/health'),

  stats: () => request('/stats'),

  /** The main call: full neuro-symbolic verification of one title. */
  verify: (payload) => request('/ai/verify', { method: 'POST', body: payload }),

  /** Fast, registry-free guideline check for live typing feedback. */
  guidelines: (title) =>
    request('/ai/guidelines', { method: 'POST', body: { title } }),

  /** Push a submitted application into the live corpus (requirement 5.b). */
  registerPending: (payload) =>
    request('/ai/pending', { method: 'POST', body: payload }),

  reload: () => request('/ai/reload', { method: 'POST' }),

  /** Never throws - used by /api/health. */
  async safeHealth() {
    try {
      return { reachable: true, ...(await request('/health')) };
    } catch (err) {
      return { reachable: false, error: err.message };
    }
  }
};

export { AiServiceError };
export default aiService;
