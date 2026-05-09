const DEFAULT_LOCALES = ['en', 'es']

function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function ensureArray(value, fallback = []) {
  return Array.isArray(value) ? value : fallback
}

function ensureObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
}

function createDefaultFields() {
  return [
    { name: 'title', label: 'Title', type: 'string', required: true, placeholder: 'Untitled item' },
    { name: 'status', label: 'Status', type: 'enum', options: ['draft', 'active', 'archived'], defaultValue: 'draft' },
    { name: 'value', label: 'Value', type: 'number', defaultValue: 0 },
  ]
}

export function buildDefaultConfig() {
  return {
    app: {
      id: 'atlas-generator',
      name: 'Atlas Generator',
      description: 'A config-driven app runtime that turns JSON into working product screens.',
      defaultLocale: 'en',
      locales: DEFAULT_LOCALES,
      theme: 'aurora',
    },
    auth: {
      methods: ['password', 'magicLink'],
      requireAuth: true,
      allowRegistration: true,
    },
    translations: {
      en: {
        appTitle: 'Atlas Generator',
        heroTitle: 'Generate an app from JSON.',
        heroSubtitle: 'UI, APIs, auth, and data all respond to the same runtime config.',
        dashboard: 'Dashboard',
        records: 'Records',
        builder: 'Builder',
        import: 'CSV Import',
        notifications: 'Notifications',
        auth: 'Authentication',
        locale: 'Locale',
        preview: 'Live Preview',
        saveConfig: 'Apply config',
        sampleConfig: 'Load sample config',
        unknownComponent: 'Unknown component',
        loading: 'Loading runtime',
      },
      es: {
        appTitle: 'Generador Atlas',
        heroTitle: 'Genera una app desde JSON.',
        heroSubtitle: 'UI, APIs, auth y datos responden a la misma configuración.',
        dashboard: 'Panel',
        records: 'Registros',
        builder: 'Constructor',
        import: 'Importar CSV',
        notifications: 'Notificaciones',
        auth: 'Autenticación',
        locale: 'Idioma',
        preview: 'Vista en vivo',
        saveConfig: 'Aplicar config',
        sampleConfig: 'Cargar ejemplo',
        unknownComponent: 'Componente desconocido',
        loading: 'Cargando runtime',
      },
    },
    database: {
      dialect: 'postgres',
      entities: [
        {
          name: 'customers',
          label: 'Customers',
          description: 'Primary customer directory for the generated app.',
          fields: [
            { name: 'name', label: 'Name', type: 'string', required: true, placeholder: 'Ada Lovelace' },
            { name: 'email', label: 'Email', type: 'email', required: true, placeholder: 'ada@company.com' },
            { name: 'segment', label: 'Segment', type: 'enum', options: ['enterprise', 'growth', 'starter'], defaultValue: 'starter' },
            { name: 'score', label: 'Score', type: 'number', defaultValue: 72 },
            { name: 'notes', label: 'Notes', type: 'textarea', optional: true, placeholder: 'Context and handoff notes' },
          ],
        },
        {
          name: 'orders',
          label: 'Orders',
          description: 'Transactions that power the dashboard and table views.',
          fields: [
            { name: 'title', label: 'Title', type: 'string', required: true, placeholder: 'Order #2001' },
            { name: 'customerName', label: 'Customer', type: 'string', required: true, placeholder: 'Ada Lovelace' },
            { name: 'amount', label: 'Amount', type: 'number', required: true, defaultValue: 0 },
            { name: 'status', label: 'Status', type: 'enum', options: ['draft', 'paid', 'shipped', 'complete'], defaultValue: 'draft' },
            { name: 'shippedAt', label: 'Shipped At', type: 'date', optional: true },
          ],
        },
      ],
    },
    pages: [
      { id: 'dashboard', title: 'Dashboard', component: 'dashboard', entity: 'orders', icon: 'grid' },
      { id: 'customers', title: 'Customers', component: 'table', entity: 'customers', icon: 'table' },
      { id: 'customers-form', title: 'Customer Form', component: 'form', entity: 'customers', icon: 'edit' },
      { id: 'csv-import', title: 'CSV Import', component: 'csvImport', entity: 'customers', icon: 'upload' },
      { id: 'notifications', title: 'Notifications', component: 'notifications', entity: 'system', icon: 'bell' },
      { id: 'experimental', title: 'Experimental Widget', component: 'mysteryPanel', entity: 'orders', icon: 'spark' },
    ],
    features: {
      csvImport: true,
      notifications: true,
      localization: true,
      auth: true,
    },
  }
}

function normalizeField(field, index, warnings, entityName) {
  const input = ensureObject(field)
  const name = slugify(input.name || input.key || `field_${index + 1}`)
  if (!name) {
    warnings.push(`Entity ${entityName}: field ${index + 1} is missing a usable name and was auto-generated.`)
  }
  return {
    name: name || `field_${index + 1}`,
    label: String(input.label || titleCase(name || `Field ${index + 1}`)),
    type: String(input.type || 'string').toLowerCase(),
    required: Boolean(input.required),
    optional: Boolean(input.optional),
    defaultValue: input.defaultValue,
    placeholder: input.placeholder ? String(input.placeholder) : '',
    options: ensureArray(input.options).map((option) => String(option)),
  }
}

function normalizeEntity(entity, index, warnings) {
  const input = ensureObject(entity)
  const name = slugify(input.name || input.id || `entity_${index + 1}`)
  if (!name) {
    warnings.push(`Entity ${index + 1} is missing a name and was auto-generated.`)
  }
  const fields = ensureArray(input.fields)
  return {
    name: name || `entity_${index + 1}`,
    label: String(input.label || titleCase(name || `Entity ${index + 1}`)),
    description: String(input.description || ''),
    primaryKey: String(input.primaryKey || 'id'),
    fields: fields.length > 0 ? fields.map((field, fieldIndex) => normalizeField(field, fieldIndex, warnings, name || `entity_${index + 1}`)) : createDefaultFields(),
  }
}

function normalizePage(page, index, warnings) {
  const input = ensureObject(page)
  const id = slugify(input.id || input.name || input.title || `page_${index + 1}`)
  const component = String(input.component || 'dashboard')
  if (!input.component) {
    warnings.push(`Page ${id || index + 1} did not declare a component and defaulted to dashboard.`)
  }
  return {
    id: id || `page_${index + 1}`,
    title: String(input.title || titleCase(id || `Page ${index + 1}`)),
    component,
    entity: String(input.entity || ''),
    icon: String(input.icon || 'spark'),
    layout: String(input.layout || 'stack'),
  }
}

export function normalizeConfig(rawConfig) {
  const warnings = []
  const fallback = buildDefaultConfig()
  const input = ensureObject(rawConfig, fallback)

  const app = ensureObject(input.app, fallback.app)
  const database = ensureObject(input.database, fallback.database)
  const auth = ensureObject(input.auth, fallback.auth)
  const translations = ensureObject(input.translations, fallback.translations)

  const locales = ensureArray(app.locales, DEFAULT_LOCALES).map((locale) => String(locale || '').trim()).filter(Boolean)
  const normalizedLocales = locales.length > 0 ? Array.from(new Set(locales)) : DEFAULT_LOCALES
  if (normalizedLocales.length !== locales.length) {
    warnings.push('Duplicate or invalid locales were removed.')
  }

  const entities = ensureArray(database.entities, fallback.database.entities).map((entity, index) => normalizeEntity(entity, index, warnings))
  if (entities.length === 0) {
    warnings.push('No entities were provided, so the default schema was restored.')
    entities.push(...fallback.database.entities.map((entity, index) => normalizeEntity(entity, index, warnings)))
  }

  const pages = ensureArray(input.pages, fallback.pages).map((page, index) => normalizePage(page, index, warnings))
  if (pages.length === 0) {
    warnings.push('No pages were provided, so a default navigation set was restored.')
    pages.push(...fallback.pages.map((page, index) => normalizePage(page, index, warnings)))
  }

  const methods = ensureArray(auth.methods, fallback.auth.methods).map((method) => String(method))

  const config = {
    app: {
      id: slugify(app.id || app.name || fallback.app.id) || fallback.app.id,
      name: String(app.name || fallback.app.name),
      description: String(app.description || fallback.app.description),
      defaultLocale: String(app.defaultLocale || normalizedLocales[0] || 'en'),
      locales: normalizedLocales,
      theme: String(app.theme || fallback.app.theme),
    },
    auth: {
      methods: methods.length > 0 ? Array.from(new Set(methods)) : fallback.auth.methods,
      requireAuth: auth.requireAuth !== false,
      allowRegistration: auth.allowRegistration !== false,
    },
    translations,
    database: {
      dialect: String(database.dialect || 'postgres'),
      entities,
    },
    pages,
    features: {
      csvImport: input.features?.csvImport !== false,
      notifications: input.features?.notifications !== false,
      localization: input.features?.localization !== false,
      auth: input.features?.auth !== false,
    },
  }

  if (!config.translations[config.app.defaultLocale]) {
    warnings.push(`Locale ${config.app.defaultLocale} is missing translations. English fallbacks will be used.`)
  }

  return {
    config,
    warnings,
    entityMap: buildEntityMap(config),
    pageMap: buildPageMap(config),
  }
}

export function buildEntityMap(config) {
  return Object.fromEntries((config.database?.entities || []).map((entity) => [entity.name, entity]))
}

export function buildPageMap(config) {
  return Object.fromEntries((config.pages || []).map((page) => [page.id, page]))
}

export function localize(translations, locale, key, fallbackLocale = 'en') {
  const localized = translations?.[locale]?.[key]
  if (localized) {
    return localized
  }
  const fallback = translations?.[fallbackLocale]?.[key]
  if (fallback) {
    return fallback
  }
  return titleCase(key)
}

function coerceByType(field, value) {
  if (value === null || value === undefined || value === '') {
    return field.defaultValue ?? ''
  }
  if (field.type === 'number') {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? (field.defaultValue ?? 0) : parsed
  }
  if (field.type === 'boolean') {
    if (typeof value === 'boolean') {
      return value
    }
    return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase())
  }
  if (field.type === 'date') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
  }
  if (field.type === 'json') {
    if (typeof value === 'object') {
      return value
    }
    try {
      return JSON.parse(String(value))
    } catch {
      return field.defaultValue ?? {}
    }
  }
  return String(value)
}

export function validateRecordInput(entity, payload = {}) {
  const errors = []
  const data = {}
  const extras = ensureObject(payload.extras)
  const fields = entity?.fields || []

  for (const field of fields) {
    const rawValue = payload[field.name]
    const hasValue = rawValue !== undefined && rawValue !== null && rawValue !== ''
    if (!hasValue && field.required && field.defaultValue === undefined && !field.optional) {
      errors.push(`${field.label || field.name} is required`)
    }
    data[field.name] = coerceByType(field, rawValue)
    if (field.type === 'enum' && field.options.length > 0 && data[field.name] && !field.options.includes(data[field.name])) {
      errors.push(`${field.label || field.name} must be one of: ${field.options.join(', ')}`)
    }
  }

  for (const [key, value] of Object.entries(payload)) {
    if (!fields.some((field) => field.name === key) && key !== 'extras') {
      extras[key] = value
    }
  }

  return {
    data,
    errors,
    extras,
  }
}

export function normalizeRecordForOutput(entity, record) {
  const output = {
    id: record.id,
    ownerId: record.ownerId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...record.data,
  }
  for (const [key, value] of Object.entries(record.extras || {})) {
    if (!(key in output)) {
      output[key] = value
    }
  }
  for (const field of entity?.fields || []) {
    if (output[field.name] === undefined) {
      output[field.name] = field.defaultValue ?? ''
    }
  }
  return output
}

export function parseCsv(text) {
  const rows = []
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)

  if (lines.length === 0) {
    return { headers: [], rows }
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim())
  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line)
    const row = {}
    headers.forEach((header, index) => {
      row[header] = values[index] ?? ''
    })
    rows.push(row)
  }

  return { headers, rows }
}

function splitCsvLine(line) {
  const values = []
  let current = ''
  let insideQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    const nextCharacter = line[index + 1]

    if (character === '"' && insideQuotes && nextCharacter === '"') {
      current += '"'
      index += 1
      continue
    }

    if (character === '"') {
      insideQuotes = !insideQuotes
      continue
    }

    if (character === ',' && !insideQuotes) {
      values.push(current)
      current = ''
      continue
    }

    current += character
  }

  values.push(current)
  return values
}

export function inferCsvMapping(headers, entity) {
  const entityFields = entity?.fields || []
  return Object.fromEntries(
    headers.map((header) => {
      const normalizedHeader = slugify(header)
      const matchedField = entityFields.find((field) => slugify(field.name) === normalizedHeader || slugify(field.label) === normalizedHeader)
      return [header, matchedField?.name || '']
    }),
  )
}

export function summarizeConfig(config) {
  return {
    appName: config.app?.name || 'Untitled app',
    localeCount: (config.app?.locales || []).length,
    entityCount: (config.database?.entities || []).length,
    pageCount: (config.pages || []).length,
    authMethods: config.auth?.methods || [],
    featureFlags: config.features || {},
  }
}
