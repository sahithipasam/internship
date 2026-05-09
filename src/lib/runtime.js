export function getLocalizedText(translations, locale, key, fallbackLocale = 'en') {
  return translations?.[locale]?.[key] || translations?.[fallbackLocale]?.[key] || key
}

export function formatValue(value) {
  if (value === null || value === undefined || value === '') {
    return '—'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

export function findEntity(config, entityName) {
  return config?.database?.entities?.find((entity) => entity.name === entityName) || null
}

export function pageLabel(page) {
  return page?.title || page?.id || 'Page'
}

export function createEmptyFormState(entity) {
  const result = {}
  for (const field of entity?.fields || []) {
    result[field.name] = field.defaultValue ?? ''
  }
  return result
}

export function buildFieldOptions(entity) {
  return (entity?.fields || []).map((field) => ({
    name: field.name,
    label: field.label || field.name,
    type: field.type || 'string',
    required: field.required,
    options: field.options || [],
    placeholder: field.placeholder || '',
  }))
}
