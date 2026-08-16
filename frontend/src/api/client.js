/**
 * PSS06 - Single place where the frontend talks to the backend.
 *
 * Everything goes through /api, which Vite proxies to Express on port 5000.
 * The JWT is attached automatically when there is one.
 */

const TOKEN_KEY = 'prgi_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY)
};

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = tokenStore.get();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    throw new ApiError(
      'Cannot reach the verification server. Is the backend running on port 5000?',
      0,
      null
    );
  }

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!res.ok || data.success === false) {
    throw new ApiError(
      data.message || data.detail || `Request failed (${res.status})`,
      res.status,
      data
    );
  }
  return data;
}

export const api = {
  // -- auth ---------------------------------------------------------------
  login: (email, password) =>
    request('/api/auth/login', { method: 'POST', body: { email, password }, auth: false }),

  googleLogin: (credential, profile = {}) =>
    request('/api/auth/google', { method: 'POST', body: { credential, ...profile }, auth: false }),

  register: (payload) =>
    request('/api/auth/register', { method: 'POST', body: payload, auth: false }),

  me: () => request('/api/auth/me'),

  verifyEmail: (email) =>
    request('/api/auth/verify-email', { method: 'POST', body: { email } }),

  resendVerification: (email) =>
    request('/api/auth/resend-verification', { method: 'POST', body: { email } }),

  // -- verification --------------------------------------------------------
  verifyTitle: (payload) =>
    request('/api/titles/verify', { method: 'POST', body: payload }),

  guidelineCheck: (title) =>
    request('/api/titles/guidelines', { method: 'POST', body: { title } }),

  searchRegistry: (q, limit = 20) =>
    request(`/api/titles/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  engine: () => request('/api/titles/engine'),

  // -- dashboard / history --------------------------------------------------
  overview: (scope = 'mine') =>
    request(`/api/dashboard/overview?scope=${scope}`),

  history: ({ scope = 'mine', decision = 'ALL', search = '', limit = 200 } = {}) => {
    const qs = new URLSearchParams({ scope, decision, limit: String(limit) });
    if (search) qs.set('search', search);
    return request(`/api/history?${qs.toString()}`);
  },

  historyDetail: (trackingId) => request(`/api/history/${trackingId}`),

  pendingApplications: (scope = 'mine') =>
    request(`/api/history/pending/list?scope=${scope}`),

  // -- admin review workflow ------------------------------------------------
  adminStats: () => request('/api/history/pending/stats'),

  adminPendingList: ({ scope = 'all', status = 'ALL', search = '', includeDecided = true } = {}) => {
    const qs = new URLSearchParams({ scope, includeDecided: String(includeDecided) });
    if (status && status !== 'ALL') qs.set('status', status);
    if (search) qs.set('search', search);
    return request(`/api/history/pending/list?${qs.toString()}`);
  },

  adminPendingDetail: (applicationRef) =>
    request(`/api/history/pending/detail/${encodeURIComponent(applicationRef)}`),

  adminUpdateDecision: (applicationRef, { status, rejectionReason } = {}) =>
    request(`/api/history/pending/${encodeURIComponent(applicationRef)}`, {
      method: 'PATCH',
      body: { status, rejectionReason }
    }),

  health: () => request('/api/health', { auth: false })
};

export default api;
