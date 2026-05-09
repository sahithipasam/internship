import { createServer as createHttpServer } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { createServer as createViteServer } from 'vite'
import {
  createAuthSession,
  createRecord,
  createUser,
  deleteRecord,
  getCurrentRuntime,
  getCurrentUser,
  getNotifications,
  getRecordById,
  getRecords,
  getSessionByToken,
  importCsvRows,
  loadStore,
  markNotificationsRead,
  parseJsonBody,
  persistRuntimeConfig,
  sanitizeEntityPayload,
  sendMagicLink,
  updateRecord,
  verifyPasswordLogin,
  verifyMagicLink,
} from './store.js'

const rootDir = resolve(process.cwd())
const distDir = join(rootDir, 'dist')
const indexHtmlPath = join(rootDir, 'index.html')
const port = Number(process.env.PORT || 8787)
const isProd = process.env.NODE_ENV === 'production'

/* =========================
   CORS FIX (VERY IMPORTANT)
========================= */
function setCorsHeaders(request, response) {
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://internship-two-mu.vercel.app'
  ]

  const origin = request.headers.origin

  if (allowedOrigins.includes(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
  }

  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.setHeader('Access-Control-Allow-Credentials', 'true')
}

/* ========================= */

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

function sendText(response, statusCode, content, contentType = 'text/plain; charset=utf-8') {
  response.statusCode = statusCode
  response.setHeader('Content-Type', contentType)
  response.end(content)
}

function getToken(request) {
  const header = request.headers.authorization || ''
  if (header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim()
  }
  return ''
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createEntityRouteMatcher(entityName) {
  const escapedName = escapeRegExp(entityName)
  const listPattern = new RegExp(`^/api/entities/${escapedName}$`)
  const recordPattern = new RegExp(`^/api/entities/${escapedName}/([^/]+)$`)
  const importPattern = new RegExp(`^/api/import/${escapedName}$`)

  return [
    {
      method: 'GET',
      pattern: listPattern,
      async handler(request, response, store, session, user) {
        if (!user) {
          return sendJson(response, 401, { error: 'Authentication required' })
        }
        const records = getRecords(store, entityName, session, user)
        return sendJson(response, 200, { entity: entityName, records })
      },
    },
    {
      method: 'POST',
      pattern: listPattern,
      async handler(request, response, store, session, user) {
        const body = await parseJsonBody(request)
        const result = await createRecord(store, entityName, sanitizeEntityPayload(body), user)
        return sendJson(response, result.status, result.body)
      },
    },
    {
      method: 'PATCH',
      pattern: recordPattern,
      async handler(request, response, store, session, user, params) {
        const recordId = params[0]
        const body = await parseJsonBody(request)
        const result = await updateRecord(store, entityName, recordId, sanitizeEntityPayload(body), session, user)
        return sendJson(response, result.status, result.body)
      },
    },
    {
      method: 'DELETE',
      pattern: recordPattern,
      async handler(request, response, store, session, user, params) {
        const recordId = params[0]
        const result = await deleteRecord(store, entityName, recordId, session, user)
        return sendJson(response, result.status, result.body)
      },
    },
    {
      method: 'POST',
      pattern: importPattern,
      async handler(request, response, store, session, user) {
        const body = await parseJsonBody(request)
        const result = await importCsvRows(store, entityName, body, session, user)
        return sendJson(response, result.status, result.body)
      },
    },
  ]
}

function buildEntityRoutes(runtime) {
  return runtime.config.database.entities.flatMap((entity) =>
    createEntityRouteMatcher(entity.name)
  )
}

function matchRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue
    const match = pathname.match(route.pattern)
    if (match) return { route, params: match.slice(1) }
  }
  return null
}

async function serveStaticAsset(response, filePath) {
  try {
    const file = await readFile(filePath)
    const extension = extname(filePath)
    const contentType =
      extension === '.js'
        ? 'application/javascript'
        : extension === '.css'
        ? 'text/css'
        : 'text/html'
    sendText(response, 200, file, contentType)
  } catch {
    sendText(response, 404, 'Not found')
  }
}

async function handleApi(request, response, url) {
  const store = await loadStore()
  const runtime = getCurrentRuntime(store)
  const session = getSessionByToken(store, getToken(request))
  const user = session ? getCurrentUser(store, session.userId) : null
  const entityRoutes = buildEntityRoutes(runtime)

  if (request.method === 'GET' && url.pathname === '/api/runtime') {
    return sendJson(response, 200, {
      config: runtime.config,
      user,
      session
    })
  }

  const matched = matchRoute(entityRoutes, request.method, url.pathname)
  if (matched) {
    return matched.route.handler(request, response, store, session, user, matched.params)
  }

  sendJson(response, 404, { error: 'Route not found' })
}

async function createServer() {
  const vite = isProd
    ? null
    : await createViteServer({
        server: { middlewareMode: true },
        appType: 'custom',
      })

  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`)

    /* 🔥 APPLY CORS HERE */
    setCorsHeaders(request, response)

    if (request.method === 'OPTIONS') {
      response.statusCode = 204
      response.end()
      return
    }

    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url)
      return
    }

    if (isProd) {
      const html = await readFile(join(distDir, 'index.html'), 'utf-8')
      sendText(response, 200, html)
      return
    }

    if (vite) {
      vite.middlewares(request, response)
    }
  })

  server.listen(port, () => {
    console.log(`Server running on port ${port}`)
  })
}

createServer()