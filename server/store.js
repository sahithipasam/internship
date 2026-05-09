import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import nodemailer from 'nodemailer'
import {
  buildDefaultConfig,
  inferCsvMapping,
  normalizeConfig,
  normalizeRecordForOutput,
  parseCsv,
  summarizeConfig,
  validateRecordInput,
} from '../shared/runtime.js'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const stateFile = join(moduleDir, 'data', 'state.json')
const runtimeStateTable = 'app_runtime_state'
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null

const emailTransporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'sahithipasam06@gmail.com',
    pass: 'xhfvpbgziyjcfnex',
  },
})

let storeCache = null
let postgresUnavailable = false
let schemaReady = false
let emailUnavailable = false

function nowIso() {
  return new Date().toISOString()
}

function hashPassword(password, salt) {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex')
}

function createPasswordState(password) {
  const salt = randomUUID()
  return {
    salt,
    hash: hashPassword(password, salt),
  }
}

function createNotification(store, userId, type, title, message, meta = {}) {
  const notification = {
    id: randomUUID(),
    userId,
    type,
    title,
    message,
    meta,
    readAt: null,
    createdAt: nowIso(),
  }
  store.notifications.unshift(notification)
  return notification
}

async function sendEmail(to, subject, text, html = '') {
  if (emailUnavailable) {
    return false
  }
  try {
    await emailTransporter.sendMail({
      from: 'sahithipasam06@gmail.com',
      to,
      subject,
      text,
      html: html || text,
    })
    return true
  } catch (error) {
    emailUnavailable = true
    console.warn(`Email sending failed: ${error.message}`)
    return false
  }
}

function getRuntimeStateId(store) {
  return store?.config?.app?.id || 'atlas-generator'
}

async function ensureSchema() {
  if (!pool || schemaReady || postgresUnavailable) {
    return
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${runtimeStateTable} (
      id text PRIMARY KEY,
      state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  schemaReady = true
}

async function readStateFromPostgres() {
  if (!pool || postgresUnavailable) {
    return null
  }

  try {
    await ensureSchema()
    const result = await pool.query(`SELECT state FROM ${runtimeStateTable} WHERE id = $1 LIMIT 1`, ['atlas-generator'])
    if (result.rowCount === 0) {
      const seeded = seedState()
      await writeStateToPostgres(seeded)
      return seeded
    }
    return result.rows[0].state
  } catch (error) {
    postgresUnavailable = true
    console.warn(`PostgreSQL unavailable, falling back to local state file: ${error.message}`)
    return null
  }
}

async function writeStateToPostgres(store) {
  if (!pool || postgresUnavailable) {
    return false
  }

  try {
    await ensureSchema()
    const stateId = getRuntimeStateId(store)
    await pool.query(
      `
        INSERT INTO ${runtimeStateTable} (id, state, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (id)
        DO UPDATE SET state = EXCLUDED.state, updated_at = now()
      `,
      [stateId, store],
    )
    return true
  } catch (error) {
    postgresUnavailable = true
    console.warn(`Failed to persist to PostgreSQL, falling back to local state file: ${error.message}`)
    return false
  }
}

function seedState() {
  const { config } = normalizeConfig(buildDefaultConfig())
  const adminId = randomUUID()
  const memberId = randomUUID()

  return {
    config,
    users: [
      {
        id: adminId,
        email: 'admin@atlas.local',
        password: createPasswordState('admin1234'),
        displayName: 'Atlas Admin',
        role: 'admin',
        locale: 'en',
        methods: ['password', 'magicLink'],
        createdAt: nowIso(),
      },
      {
        id: memberId,
        email: 'member@atlas.local',
        password: createPasswordState('member1234'),
        displayName: 'Atlas Member',
        role: 'member',
        locale: 'es',
        methods: ['password', 'magicLink'],
        createdAt: nowIso(),
      },
    ],
    sessions: [],
    magicLinks: [],
    notifications: [],
    records: {
      customers: [
        {
          id: randomUUID(),
          ownerId: adminId,
          data: {
            name: 'Ada Lovelace',
            email: 'ada@atlas.local',
            segment: 'enterprise',
            score: 98,
            notes: 'Key customer for launch phase',
          },
          extras: { source: 'seed' },
          createdAt: nowIso(),
          updatedAt: nowIso(),
        },
        {
          id: randomUUID(),
          ownerId: memberId,
          data: {
            name: 'Grace Hopper',
            email: 'grace@atlas.local',
            segment: 'growth',
            score: 91,
            notes: 'Prefers weekly summaries',
          },
          extras: { source: 'seed' },
          createdAt: nowIso(),
          updatedAt: nowIso(),
        },
      ],
      orders: [
        {
          id: randomUUID(),
          ownerId: adminId,
          data: {
            title: 'Order #2001',
            customerName: 'Ada Lovelace',
            amount: 1800,
            status: 'paid',
            shippedAt: '2026-05-03',
          },
          extras: { priority: 'high' },
          createdAt: nowIso(),
          updatedAt: nowIso(),
        },
      ],
    },
    archivedRecords: {},
    auditLog: [],
  }
}

async function persist(store) {
  const persisted = await writeStateToPostgres(store)
  if (persisted) {
    return
  }
  await mkdir(dirname(stateFile), { recursive: true })
  await writeFile(stateFile, JSON.stringify(store, null, 2), 'utf-8')
}

function remapRecords(previousRecords, nextConfig) {
  const nextEntities = new Set(nextConfig.database.entities.map((entity) => entity.name))
  const remapped = {}
  for (const entity of nextConfig.database.entities) {
    remapped[entity.name] = Array.isArray(previousRecords?.[entity.name]) ? previousRecords[entity.name] : []
  }
  for (const [entityName, records] of Object.entries(previousRecords || {})) {
    if (!nextEntities.has(entityName)) {
      remapped[entityName] = Array.isArray(records) ? records : []
    }
  }
  return remapped
}

export async function loadStore() {
  if (storeCache) {
    return storeCache
  }

  if (!postgresUnavailable && pool) {
    const postgresState = await readStateFromPostgres()
    if (postgresState) {
      storeCache = postgresState
    }
  }

  if (!storeCache) {
    try {
      const raw = await readFile(stateFile, 'utf-8')
      storeCache = JSON.parse(raw)
    } catch {
      storeCache = seedState()
      await persist(storeCache)
    }
  }

  storeCache.config = normalizeConfig(storeCache.config).config
  storeCache.records = remapRecords(storeCache.records, storeCache.config)

  if (!postgresUnavailable && pool) {
    await writeStateToPostgres(storeCache)
  }

  return storeCache
}

export function getCurrentRuntime(store) {
  const normalized = normalizeConfig(store.config)
  return {
    config: normalized.config,
    warnings: normalized.warnings,
    entityMap: normalized.entityMap,
    pageMap: normalized.pageMap,
    summary: summarizeConfig(normalized.config),
  }
}

export function getSessionByToken(store, token) {
  if (!token) {
    return null
  }
  const session = store.sessions.find((entry) => entry.token === token && new Date(entry.expiresAt).getTime() > Date.now())
  return session || null
}

export function getCurrentUser(store, userId) {
  return store.users.find((user) => user.id === userId) || null
}

export function getNotifications(store, user) {
  if (!user) {
    return []
  }
  return store.notifications
    .filter((notification) => notification.userId === user.id || user.role === 'admin')
    .slice(0, 50)
}

export async function markNotificationsRead(store, notificationIds, user) {
  if (!user) {
    return { status: 401, body: { error: 'Not authenticated' } }
  }
  const ids = new Set(Array.isArray(notificationIds) ? notificationIds : [])
  store.notifications = store.notifications.map((notification) => {
    if (notification.userId !== user.id && user.role !== 'admin') {
      return notification
    }
    if (!ids.has(notification.id)) {
      return notification
    }
    return { ...notification, readAt: nowIso() }
  })
  await persist(store)
  return { status: 200, body: { ok: true } }
}

export async function persistRuntimeConfig(store, rawConfig) {
  const normalized = normalizeConfig(rawConfig)
  const nextRecords = remapRecords(store.records, normalized.config)
  store.config = normalized.config
  store.records = nextRecords
  store.auditLog.unshift({
    id: randomUUID(),
    type: 'runtime.updated',
    createdAt: nowIso(),
    details: normalized.warnings,
  })
  await persist(store)
  return {
    ok: true,
    config: normalized.config,
    warnings: normalized.warnings,
    summary: summarizeConfig(normalized.config),
  }
}

function buildSession(store, userId, source = 'password') {
  const token = randomUUID()
  const session = {
    token,
    userId,
    source,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
  }
  store.sessions = store.sessions.filter((entry) => entry.userId !== userId)
  store.sessions.push(session)
  return session
}

export async function createAuthSession(store, userId, source, options = {}) {
  if (options.revoke) {
    store.sessions = store.sessions.filter((entry) => entry.userId !== userId)
    await persist(store)
    return { status: 200, body: { ok: true } }
  }
  const session = buildSession(store, userId, source)
  await persist(store)
  return { status: 200, body: { ok: true, session } }
}

function getAuthMethods(store) {
  return new Set(store.config?.auth?.methods || [])
}

export async function createUser(store, body) {
  const methods = getAuthMethods(store)
  if (!methods.has('password')) {
    return { status: 400, body: { error: 'Password auth is disabled by config' } }
  }
  const email = String(body.email || '').toLowerCase().trim()
  const password = String(body.password || '')
  const displayName = String(body.displayName || email.split('@')[0] || 'User')
  if (!email || !password) {
    return { status: 400, body: { error: 'Email and password are required' } }
  }
  if (store.users.some((user) => user.email === email)) {
    return { status: 409, body: { error: 'User already exists' } }
  }
  const user = {
    id: randomUUID(),
    email,
    password: createPasswordState(password),
    displayName,
    role: 'member',
    locale: store.config.app.defaultLocale,
    methods: Array.from(getAuthMethods(store)),
    createdAt: nowIso(),
  }
  store.users.push(user)
  const session = buildSession(store, user.id, 'register')
  createNotification(store, user.id, 'auth.registered', 'Account created', `Welcome, ${user.displayName}.`, { email: user.email })
  await persist(store)
  await sendEmail(
    email,
    'Welcome to Atlas Generator',
    `Hi ${displayName},\n\nYour account has been created. You can now log in with your email and password.\n\nWelcome aboard!\n\nBest regards,\nAtlas Team`,
  )
  return { status: 200, body: { user: { ...user, password: undefined }, session } }
}

export async function verifyPasswordLogin(store, body) {
  const methods = getAuthMethods(store)
  if (!methods.has('password')) {
    return { status: 400, body: { error: 'Password auth is disabled by config' } }
  }
  const email = String(body.email || '').toLowerCase().trim()
  const password = String(body.password || '')
  const user = store.users.find((entry) => entry.email === email)
  if (!user) {
    return { status: 404, body: { error: 'User not found' } }
  }
  if (user.password.hash !== hashPassword(password, user.password.salt)) {
    return { status: 401, body: { error: 'Invalid password' } }
  }
  const session = buildSession(store, user.id, 'password')
  user.lastLoginAt = nowIso()
  createNotification(store, user.id, 'auth.login', 'Signed in', `You signed in as ${user.displayName}.`, { method: 'password' })
  await persist(store)
  return { status: 200, body: { user: { ...user, password: undefined }, session } }
}

export async function sendMagicLink(store, body) {
  const methods = getAuthMethods(store)
  if (!methods.has('magicLink')) {
    return { status: 400, body: { error: 'Magic link auth is disabled by config' } }
  }
  const email = String(body.email || '').toLowerCase().trim()
  if (!email) {
    return { status: 400, body: { error: 'Email is required' } }
  }
  const user = store.users.find((entry) => entry.email === email)
  if (!user) {
    return { status: 404, body: { error: 'User not found' } }
  }
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const magicLink = {
    id: randomUUID(),
    email,
    code,
    userId: user.id,
    expiresAt: new Date(Date.now() + 1000 * 60 * 10).toISOString(),
    createdAt: nowIso(),
  }
  store.magicLinks.push(magicLink)
  createNotification(store, user.id, 'auth.magic_link', 'Magic link sent', `Use code ${code} to finish signing in.`, { code })
  await persist(store)
  await sendEmail(
    email,
    'Your Magic Link Code',
    `Hi ${user.displayName},\n\nYour magic link code is: ${code}\n\nThis code will expire in 10 minutes.\n\nDo not share this code with anyone.\n\nBest regards,\nAtlas Team`,
  )
  return { status: 200, body: { ok: true, delivery: { email, code, expiresAt: magicLink.expiresAt } } }
}

export async function verifyMagicLink(store, body) {
  const email = String(body.email || '').toLowerCase().trim()
  const code = String(body.code || '').trim()
  if (!email || !code) {
    return { status: 400, body: { error: 'Email and code are required' } }
  }
  const link = store.magicLinks.find((entry) => entry.email === email && entry.code === code && new Date(entry.expiresAt).getTime() > Date.now())
  if (!link) {
    return { status: 401, body: { error: 'Invalid or expired code' } }
  }
  const user = store.users.find((entry) => entry.id === link.userId)
  if (!user) {
    return { status: 404, body: { error: 'User not found' } }
  }
  const session = buildSession(store, user.id, 'magicLink')
  createNotification(store, user.id, 'auth.login', 'Magic link accepted', `Signed in with your emailed code.`, { method: 'magicLink' })
  store.magicLinks = store.magicLinks.filter((entry) => entry.id !== link.id)
  await persist(store)
  return { status: 200, body: { user: { ...user, password: undefined }, session } }
}

export function sanitizeEntityPayload(body) {
  return body && typeof body === 'object' ? body : {}
}

function canAccessRecord(record, session, user) {
  if (!user) {
    return false
  }
  if (user.role === 'admin') {
    return true
  }
  return record.ownerId === user.id || (session && session.userId === user.id)
}

export function getRecords(store, entityName, session, user) {
  const records = Array.isArray(store.records?.[entityName]) ? store.records[entityName] : []
  const entity = store.config.database.entities.find((entry) => entry.name === entityName)
  return records.filter((record) => canAccessRecord(record, session, user)).map((record) => normalizeRecordForOutput(entity, record))
}

export function getRecordById(store, entityName, recordId, session, user) {
  const entity = store.config.database.entities.find((entry) => entry.name === entityName)
  const record = (store.records?.[entityName] || []).find((entry) => entry.id === recordId)
  if (!record || !canAccessRecord(record, session, user)) {
    return null
  }
  return normalizeRecordForOutput(entity, record)
}

export async function createRecord(store, entityName, body, user) {
  if (!user) {
    return { status: 401, body: { error: 'Authentication required' } }
  }
  const entity = store.config.database.entities.find((entry) => entry.name === entityName)
  if (!entity) {
    return { status: 404, body: { error: 'Unknown entity' } }
  }
  const validation = validateRecordInput(entity, body)
  if (validation.errors.length > 0) {
    return { status: 400, body: { error: 'Validation failed', details: validation.errors } }
  }
  const record = {
    id: randomUUID(),
    ownerId: user.id,
    data: validation.data,
    extras: validation.extras,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  store.records[entityName] = Array.isArray(store.records[entityName]) ? store.records[entityName] : []
  store.records[entityName].unshift(record)
  createNotification(store, user.id, 'record.created', `${entity.label} created`, `Created a new ${entity.label.toLowerCase()} record.`, { entity: entityName, recordId: record.id })
  await persist(store)
  return { status: 200, body: { record: normalizeRecordForOutput(entity, record) } }
}

export async function updateRecord(store, entityName, recordId, body, session, user) {
  if (!user) {
    return { status: 401, body: { error: 'Authentication required' } }
  }
  const entity = store.config.database.entities.find((entry) => entry.name === entityName)
  const existing = (store.records?.[entityName] || []).find((record) => record.id === recordId)
  if (!entity || !existing || !canAccessRecord(existing, session, user)) {
    return { status: 404, body: { error: 'Record not found' } }
  }
  const mergedInput = { ...existing.data, ...existing.extras, ...body }
  const validation = validateRecordInput(entity, mergedInput)
  if (validation.errors.length > 0) {
    return { status: 400, body: { error: 'Validation failed', details: validation.errors } }
  }
  existing.data = validation.data
  existing.extras = validation.extras
  existing.updatedAt = nowIso()
  createNotification(store, user.id, 'record.updated', `${entity.label} updated`, `Updated ${entity.label.toLowerCase()} record ${recordId}.`, { entity: entityName, recordId })
  await persist(store)
  return { status: 200, body: { record: normalizeRecordForOutput(entity, existing) } }
}

export async function deleteRecord(store, entityName, recordId, session, user) {
  if (!user) {
    return { status: 401, body: { error: 'Authentication required' } }
  }
  const entity = store.config.database.entities.find((entry) => entry.name === entityName)
  const recordIndex = (store.records?.[entityName] || []).findIndex((record) => record.id === recordId)
  if (!entity || recordIndex < 0) {
    return { status: 404, body: { error: 'Record not found' } }
  }
  const record = store.records[entityName][recordIndex]
  if (!canAccessRecord(record, session, user)) {
    return { status: 403, body: { error: 'Access denied' } }
  }
  store.records[entityName].splice(recordIndex, 1)
  createNotification(store, user.id, 'record.deleted', `${entity.label} deleted`, `Deleted ${entity.label.toLowerCase()} record ${recordId}.`, { entity: entityName, recordId })
  await persist(store)
  return { status: 200, body: { ok: true } }
}

export async function importCsvRows(store, entityName, body, session, user) {
  if (!user) {
    return { status: 401, body: { error: 'Authentication required' } }
  }
  const entity = store.config.database.entities.find((entry) => entry.name === entityName)
  if (!entity) {
    return { status: 404, body: { error: 'Unknown entity' } }
  }
  const csvText = String(body.csvText || '')
  const { headers, rows } = parseCsv(csvText)
  if (headers.length === 0) {
    return { status: 400, body: { error: 'CSV file is empty' } }
  }
  const mapping = body.mapping && typeof body.mapping === 'object' ? body.mapping : inferCsvMapping(headers, entity)
  const created = []
  const errors = []

  for (const [rowIndex, row] of rows.entries()) {
    const normalized = {}
    for (const [header, value] of Object.entries(row)) {
      const targetField = mapping[header]
      if (targetField) {
        normalized[targetField] = value
      } else {
        normalized[`extra_${header}`] = value
      }
    }
    const validation = validateRecordInput(entity, normalized)
    if (validation.errors.length > 0) {
      errors.push({ row: rowIndex + 2, errors: validation.errors })
      continue
    }
    const record = {
      id: randomUUID(),
      ownerId: user.id,
      data: validation.data,
      extras: validation.extras,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    store.records[entityName] = Array.isArray(store.records[entityName]) ? store.records[entityName] : []
    store.records[entityName].unshift(record)
    created.push(normalizeRecordForOutput(entity, record))
  }

  if (created.length > 0) {
    createNotification(store, user.id, 'import.completed', `${entity.label} imported`, `Imported ${created.length} ${entity.label.toLowerCase()} records from CSV.`, { entity: entityName, count: created.length })
  }
  await persist(store)
  return { status: 200, body: { created, errors } }
}

export async function parseJsonBody(request) {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim()
  if (!raw) {
    return {}
  }
  try {
    return JSON.parse(raw)
  } catch {
    return { raw }
  }
}
