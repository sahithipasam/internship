async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) {
    const error = new Error(body?.error || 'Request failed')
    error.details = body?.details || []
    error.status = response.status
    throw error
  }
  return body
}

export const api = {
  getRuntime: () => request('/api/runtime'),
  updateRuntime: (config) => request('/api/runtime', { method: 'PUT', body: JSON.stringify({ config }) }),
  register: (payload) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  sendMagicLink: (payload) => request('/api/auth/magic-link', { method: 'POST', body: JSON.stringify(payload) }),
  verifyMagicLink: (payload) => request('/api/auth/magic-link/verify', { method: 'POST', body: JSON.stringify(payload) }),
  me: (token) => request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
  logout: (token) => request('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }),
  listRecords: (entity, token) => request(`/api/entities/${entity}`, { headers: { Authorization: `Bearer ${token}` } }),
  createRecord: (entity, token, payload) => request(`/api/entities/${entity}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) }),
  updateRecord: (entity, id, token, payload) => request(`/api/entities/${entity}/${id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) }),
  deleteRecord: (entity, id, token) => request(`/api/entities/${entity}/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
  importCsv: (entity, token, payload) => request(`/api/import/${entity}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) }),
  notifications: (token) => request('/api/notifications', { headers: { Authorization: `Bearer ${token}` } }),
  markRead: (token, notificationIds) => request('/api/notifications/read', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ notificationIds }) }),
}
