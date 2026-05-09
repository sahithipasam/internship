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

function setCorsHeaders(request, response) {
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    process.env.FRONTEND_URL,
  ].filter(Boolean)
  
  const origin = request.headers.origin || ''
  const isAllowed = allowedOrigins.some(allowed => 
    allowed === origin || allowed === '*'
  )
  
  if (isAllowed) {
    response.setHeader('Access-Control-Allow-Origin', origin || allowedOrigins[0])
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    response.setHeader('Access-Control-Max-Age', '86400')
  }
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
      method: 'GET',
      pattern: recordPattern,
      async handler(request, response, store, session, user, params) {
        if (!user) {
          return sendJson(response, 401, { error: 'Authentication required' })
        }
        const recordId = params[0]
        const record = getRecordById(store, entityName, recordId, session, user)
        if (!record) {
          return sendJson(response, 404, { error: 'Record not found' })
        }
        return sendJson(response, 200, { entity: entityName, record })
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
  return runtime.config.database.entities.flatMap((entity) => createEntityRouteMatcher(entity.name))
}

function matchRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method !== method) {
      continue
    }
    const match = pathname.match(route.pattern)
    if (match) {
      return { route, params: match.slice(1) }
    }
  }
  return null
}

async function serveStaticAsset(response, filePath) {
  try {
    const file = await readFile(filePath)
    const extension = extname(filePath)
    const contentType =
      extension === '.js'
        ? 'application/javascript; charset=utf-8'
        : extension === '.css'
          ? 'text/css; charset=utf-8'
          : extension === '.svg'
            ? 'image/svg+xml'
            : extension === '.json'
              ? 'application/json; charset=utf-8'
              : extension === '.png'
                ? 'image/png'
                : 'text/html; charset=utf-8'
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

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(response, 200, { ok: true, mode: isProd ? 'production' : 'development' })
  }

  if (request.method === 'GET' && url.pathname === '/api/runtime') {
    return sendJson(response, 200, {
      config: runtime.config,
      warnings: runtime.warnings,
      summary: runtime.summary,
      pages: runtime.config.pages,
      user,
      session: session ? { token: session.token, userId: session.userId, expiresAt: session.expiresAt } : null,
    })
  }

  if (request.method === 'PUT' && url.pathname === '/api/runtime') {
    const body = await parseJsonBody(request)
    const result = await persistRuntimeConfig(store, body.config || body)
    return sendJson(response, 200, result)
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/register') {
    const body = await parseJsonBody(request)
    const result = await createUser(store, body)
    return sendJson(response, result.status, result.body)
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await parseJsonBody(request)
    const result = await verifyPasswordLogin(store, body)
    return sendJson(response, result.status, result.body)
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/magic-link') {
    const body = await parseJsonBody(request)
    const result = await sendMagicLink(store, body)
    return sendJson(response, result.status, result.body)
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/magic-link/verify') {
    const body = await parseJsonBody(request)
    const result = await verifyMagicLink(store, body)
    return sendJson(response, result.status, result.body)
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/me') {
    if (!session || !user) {
      return sendJson(response, 401, { error: 'Not authenticated' })
    }
    return sendJson(response, 200, { user, session })
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    if (session) {
      await createAuthSession(store, session.userId, 'logout', { revoke: true })
    }
    return sendJson(response, 200, { ok: true })
  }

  const matchedEntityRoute = matchRoute(entityRoutes, request.method, url.pathname)
  if (matchedEntityRoute) {
    return matchedEntityRoute.route.handler(request, response, store, session, user, matchedEntityRoute.params)
  }

  if (request.method === 'GET' && url.pathname === '/api/notifications') {
    if (!user) {
      return sendJson(response, 401, { error: 'Not authenticated' })
    }
    return sendJson(response, 200, { notifications: getNotifications(store, user) })
  }

  if (request.method === 'POST' && url.pathname === '/api/notifications/read') {
    const body = await parseJsonBody(request)
    const result = await markNotificationsRead(store, body.notificationIds || [], user)
    return sendJson(response, result.status, result.body)
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

  await loadStore()

  const server = createHttpServer(async (request, response) => {
    const host = request.headers.host || `localhost:${port}`
    const url = new URL(request.url || '/', `http://${host}`)

    // Set CORS headers for all requests
    setCorsHeaders(request, response)

    // Handle OPTIONS preflight requests
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
      const assetPath = join(distDir, url.pathname)
      if (url.pathname !== '/' && existsSync(assetPath)) {
        await serveStaticAsset(response, assetPath)
        return
      }
      const html = await readFile(join(distDir, 'index.html'), 'utf-8')
      sendText(response, 200, html, 'text/html; charset=utf-8')
      return
    }

    if (vite) {
      vite.middlewares(request, response, async () => {
        try {
          const template = await readFile(indexHtmlPath, 'utf-8')
          const html = await vite.transformIndexHtml(url.pathname, template)
          sendText(response, 200, html, 'text/html; charset=utf-8')
        } catch (error) {
          sendJson(response, 500, { error: error.message })
        }
      })
      return
    }

    sendText(response, 500, 'Server not available')
  })

  server.listen(port, () => {
    console.log(`Atlas Generator running on http://localhost:${port}`)
  })
}

createServer().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
