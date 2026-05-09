import { useEffect, useState } from 'react'
import { api } from './lib/api'
import { buildFieldOptions, createEmptyFormState, findEntity, formatValue, getLocalizedText, pageLabel } from './lib/runtime'
import './App.css'

const demoCsv = `name,email,segment,score,notes
Maria Chen,maria@northwind.dev,enterprise,97,Imported from events booth
Jonas Reed,jonas@northwind.dev,growth,88,Needs quarterly check-in`

function App() {
  const [runtime, setRuntime] = useState(null)
  const [runtimeDraft, setRuntimeDraft] = useState('')
  const [locale, setLocale] = useState('en')
  const [activePageId, setActivePageId] = useState('dashboard')
  const [token, setToken] = useState(() => localStorage.getItem('atlas_token') || '')
  const [currentUser, setCurrentUser] = useState(null)
  const [loadingRuntime, setLoadingRuntime] = useState(true)
  const [runtimeError, setRuntimeError] = useState('')
  const [saveState, setSaveState] = useState({ status: 'idle', message: '' })
  const [authState, setAuthState] = useState({ mode: 'login', email: 'admin@atlas.local', password: 'admin1234', displayName: '' })
  const [authMessage, setAuthMessage] = useState('')
  const [entityDrafts, setEntityDrafts] = useState({})
  const [entityLists, setEntityLists] = useState({})
  const [formError, setFormError] = useState('')
  const [activeImport, setActiveImport] = useState({ entity: 'customers', csvText: demoCsv, mapping: {}, result: null })
  const [notifications, setNotifications] = useState([])
  const [busyEntity, setBusyEntity] = useState('')
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)

  useEffect(() => {
    void (async () => {
      setLoadingRuntime(true)
      setRuntimeError('')
      try {
        const data = await api.getRuntime()
        setRuntime(data)
        setRuntimeDraft(JSON.stringify(data.config, null, 2))
        setLocale(data.user?.locale || data.config?.app?.defaultLocale || 'en')
        setActivePageId(data.pages?.[0]?.id || 'dashboard')
        setAuthMessage(data.warnings?.length ? data.warnings.join(' ') : '')
        if (data.session?.token) {
          setToken(data.session.token)
        }
        await refreshEntityData(data.config, data.session?.token || token)
        await refreshNotifications(data.session?.token || token)
      } catch (error) {
        setRuntimeError(error.message)
      } finally {
        setLoadingRuntime(false)
      }
    })()
  }, [token])

  useEffect(() => {
    localStorage.setItem('atlas_token', token)
  }, [token])

  useEffect(() => {
    if (!token) {
      return
    }

    void (async () => {
      try {
        const data = await api.me(token)
        setCurrentUser(data.user)
        setLocale(data.user?.locale || data.config?.app?.defaultLocale || 'en')
        if (runtime?.config) {
          await refreshEntityData(runtime.config, token)
          await refreshNotifications(token)
        }
      } catch {
        setToken('')
        setCurrentUser(null)
        localStorage.removeItem('atlas_token')
      }
    })()
  }, [token, runtime])

  const config = runtime?.config || null
  const summary = runtime?.summary || { entityCount: 0, pageCount: 0, localeCount: 0, authMethods: [] }
  const pages = config?.pages || []
  const activePage = pages.find((page) => page.id === activePageId) || pages[0] || null
  const activeEntity = findEntity(config, activePage?.entity) || config?.database?.entities?.[0] || null
  const t = (key) => getLocalizedText(config?.translations || {}, locale, key, config?.app?.defaultLocale || 'en')

  const importHeaders = parseCsvHeaders(activeImport.csvText)
  const importRows = parseCsvRows(activeImport.csvText)
  const importMapping = Object.keys(activeImport.mapping).length > 0 ? activeImport.mapping : inferMapping(importHeaders, findEntity(config, activeImport.entity))

  async function refreshRuntime() {
    setLoadingRuntime(true)
    setRuntimeError('')
    try {
      const data = await api.getRuntime()
      setRuntime(data)
      setRuntimeDraft(JSON.stringify(data.config, null, 2))
      setLocale(data.user?.locale || data.config?.app?.defaultLocale || 'en')
      setActivePageId(data.pages?.[0]?.id || 'dashboard')
      setAuthMessage(data.warnings?.length ? data.warnings.join(' ') : '')
      if (data.session?.token) {
        setToken(data.session.token)
      }
      await refreshEntityData(data.config, data.session?.token || token)
      await refreshNotifications(data.session?.token || token)
    } catch (error) {
      setRuntimeError(error.message)
    } finally {
      setLoadingRuntime(false)
    }
  }

  async function refreshEntityData(configData, authToken) {
    if (!configData?.database?.entities?.length) {
      return
    }
    const nextLists = {}
    for (const entity of configData.database.entities) {
      try {
        const response = await api.listRecords(entity.name, authToken)
        nextLists[entity.name] = response.records || []
      } catch {
        nextLists[entity.name] = []
      }
    }
    setEntityLists(nextLists)
    const nextDrafts = {}
    for (const entity of configData.database.entities) {
      nextDrafts[entity.name] = createEmptyFormState(entity)
    }
    setEntityDrafts((previous) => ({ ...nextDrafts, ...previous }))
  }

  async function refreshNotifications(authToken) {
    if (!authToken) {
      return
    }
    try {
      const data = await api.notifications(authToken)
      setNotifications(data.notifications || [])
    } catch {
      setNotifications([])
    }
  }

  async function handleApplyConfig() {
    setSaveState({ status: 'loading', message: 'Applying runtime config...' })
    setRuntimeError('')
    try {
      const parsed = JSON.parse(runtimeDraft)
      const result = await api.updateRuntime(parsed)
      setRuntime({ config: result.config, warnings: result.warnings, summary: result.summary, pages: result.config.pages })
      setRuntimeDraft(JSON.stringify(result.config, null, 2))
      setSaveState({ status: 'success', message: result.warnings?.length ? result.warnings.join(' ') : 'Runtime updated.' })
      await refreshEntityData(result.config, token)
      await refreshNotifications(token)
      if (!result.config.pages.some((page) => page.id === activePageId)) {
        setActivePageId(result.config.pages[0]?.id || 'dashboard')
      }
    } catch (error) {
      setSaveState({ status: 'error', message: error.message })
    }
  }

  async function handleLoginSubmit(event) {
    event.preventDefault()
    setAuthMessage('')
    try {
      if (authState.mode === 'register') {
        const response = await api.register({
          email: authState.email,
          password: authState.password,
          displayName: authState.displayName,
        })
        setToken(response.session.token)
        setCurrentUser(response.user)
        setAuthMessage(`Account created for ${response.user.email}`)
      } else if (authState.mode === 'magic') {
        const response = await api.sendMagicLink({ email: authState.email })
        setAuthMessage(`Magic code sent to ${response.delivery.email}. Demo code: ${response.delivery.code}`)
      } else if (authState.mode === 'verify') {
        const response = await api.verifyMagicLink({ email: authState.email, code: authState.password })
        setToken(response.session.token)
        setCurrentUser(response.user)
        setAuthMessage(`Signed in as ${response.user.displayName}`)
      } else {
        const response = await api.login({ email: authState.email, password: authState.password })
        setToken(response.session.token)
        setCurrentUser(response.user)
        setAuthMessage(`Signed in as ${response.user.displayName}`)
      }
      await refreshRuntime()
    } catch (error) {
      setAuthMessage(error.message)
    }
  }

  async function handleLogout() {
    try {
      await api.logout(token)
    } catch {
      // ignore logout failures in demo mode
    }
    setToken('')
    setCurrentUser(null)
    localStorage.removeItem('atlas_token')
    setAuthMessage('Signed out')
  }

  async function handleCreateRecord(entityName, payload) {
    if (!token) {
      setFormError('Sign in before creating records.')
      return
    }
    setBusyEntity(entityName)
    setFormError('')
    try {
      const response = await api.createRecord(entityName, token, payload)
      setEntityLists((previous) => ({
        ...previous,
        [entityName]: [response.record, ...(previous[entityName] || [])],
      }))
      setEntityDrafts((previous) => ({
        ...previous,
        [entityName]: createEmptyFormState(findEntity(config, entityName)),
      }))
      await refreshNotifications(token)
    } catch (error) {
      setFormError(error.details?.length ? error.details.join(', ') : error.message)
    } finally {
      setBusyEntity('')
    }
  }

  async function handleDeleteRecord(entityName, recordId) {
    if (!token) {
      return
    }
    setBusyEntity(entityName)
    try {
      await api.deleteRecord(entityName, recordId, token)
      setEntityLists((previous) => ({
        ...previous,
        [entityName]: (previous[entityName] || []).filter((record) => record.id !== recordId),
      }))
      await refreshNotifications(token)
    } catch (error) {
      setFormError(error.message)
    } finally {
      setBusyEntity('')
    }
  }

  async function handleImportCsv() {
    if (!token) {
      setFormError('Sign in to import CSV data.')
      return
    }
    setBusyEntity('import')
    setFormError('')
    try {
      const response = await api.importCsv(activeImport.entity, token, {
        csvText: activeImport.csvText,
        mapping: importMapping,
      })
      setActiveImport((previous) => ({ ...previous, result: response }))
      await refreshEntityData(config, token)
      await refreshNotifications(token)
    } catch (error) {
      setFormError(error.details?.length ? error.details.join(', ') : error.message)
    } finally {
      setBusyEntity('')
    }
  }

  async function handleMarkNotificationsRead() {
    const wasOpen = isNotificationsOpen
    setIsNotificationsOpen((previous) => !previous)
    if (!wasOpen && token && unreadNotificationCount > 0) {
      const unreadIds = notifications.filter((notification) => !notification.readAt).map((notification) => notification.id)
      try {
        await api.markRead(token, unreadIds)
        await refreshNotifications(token)
      } catch {
        // ignore mark read failures
      }
    }
  }

  function handleResetDraft() {
    setRuntimeDraft(JSON.stringify(runtime?.config || {}, null, 2))
    setSaveState({ status: 'success', message: 'Draft reset to the current runtime config.' })
  }

  const unreadNotificationCount = notifications.filter((notification) => !notification.readAt).length

  const dashboardMetrics = {
    counts: (config?.database?.entities || []).map((entity) => ({
      entity,
      count: entityLists[entity.name]?.length || 0,
    })),
    total: (config?.database?.entities || []).reduce((sum, entity) => sum + (entityLists[entity.name]?.length || 0), 0),
  }

  if (loadingRuntime) {
    return <LoadingState label={t('loading')} />
  }

  if (runtimeError) {
    return <ErrorState message={runtimeError} onRetry={refreshRuntime} />
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Config-driven application runtime</p>
          <h1>{t('heroTitle')}</h1>
          <p className="lede">{t('heroSubtitle')}</p>
        </div>
        <div className="topbar-actions">
          <LocaleSwitcher locale={locale} onChange={setLocale} locales={config?.app?.locales || ['en']} label={t('locale')} />
          <button type="button" className="chip-button notification-trigger" onClick={handleMarkNotificationsRead} aria-expanded={isNotificationsOpen} aria-controls="notification-popover">
            <span>{t('notifications')}</span>
            {unreadNotificationCount > 0 ? <span className="notification-dot" aria-label={`${unreadNotificationCount} unread notifications`} /> : null}
          </button>
          <button type="button" className="primary-button" onClick={handleResetDraft}>
            Reset draft
          </button>
        </div>
      </header>

      {isNotificationsOpen ? (
        <div className="notification-popover" id="notification-popover" role="dialog" aria-label="Notifications">
          <div className="notification-popover-header">
            <h2>Notifications</h2>
            <button type="button" className="popover-close" onClick={() => setIsNotificationsOpen(false)} aria-label="Close notifications">
              ×
            </button>
          </div>
          {notifications.length > 0 ? (
            <ul className="notification-popover-list">
              {notifications.slice(0, 8).map((notification) => (
                <li key={notification.id} className={notification.readAt ? 'read' : 'unread'}>
                  <strong>{notification.title}</strong>
                  <span>{notification.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyInline message="No notifications yet." />
          )}
        </div>
      ) : null}

      <section className="stats-grid">
        <StatCard label="Entities" value={summary.entityCount} hint="Dynamic database tables" />
        <StatCard label="Pages" value={summary.pageCount} hint="Generated navigation and screens" />
        <StatCard label="Locales" value={summary.localeCount} hint="Config-driven localization" />
        <StatCard label="Records" value={dashboardMetrics.total} hint="Scoped to the active user" />
      </section>

      <section className="workspace">
        <aside className="sidebar">
          <Panel title={t('auth')} tone="glow">
            <AuthPanel
              authState={authState}
              onChange={setAuthState}
              onSubmit={handleLoginSubmit}
              onLogout={handleLogout}
              onToggleMode={(mode) => setAuthState((previous) => ({ ...previous, mode }))}
              currentUser={currentUser}
              token={token}
              message={authMessage}
            />
          </Panel>

          <Panel title={t('builder')}>
            <div className="stack">
              <label className="field-label" htmlFor="runtime-json">Runtime JSON</label>
              <textarea
                id="runtime-json"
                className="config-editor"
                value={runtimeDraft}
                onChange={(event) => setRuntimeDraft(event.target.value)}
                spellCheck="false"
              />
              <div className="panel-actions">
                <button type="button" className="primary-button" onClick={handleApplyConfig}>
                  {t('saveConfig')}
                </button>
                <button type="button" className="ghost-button" onClick={refreshRuntime}>
                  Reload runtime
                </button>
              </div>
              {saveState.message ? <InlineNotice status={saveState.status} message={saveState.message} /> : null}
              {runtime?.warnings?.length ? <WarningList warnings={runtime.warnings} /> : null}
            </div>
          </Panel>
        </aside>

        <main className="preview-panel">
          <Panel title={t('preview')} tone="accent">
            <nav className="page-tabs" aria-label="Generated pages">
              {pages.map((page) => (
                <button key={page.id} type="button" className={page.id === activePageId ? 'page-tab active' : 'page-tab'} onClick={() => setActivePageId(page.id)}>
                  {pageLabel(page)}
                </button>
              ))}
            </nav>

            {activePage ? (
              {
                dashboard: <DashboardView entity={activeEntity} entityLists={entityLists} dashboardMetrics={dashboardMetrics} locale={locale} t={t} />,
                table: <TableView entity={activeEntity} entityLists={entityLists} onDeleteRecord={handleDeleteRecord} busyEntity={busyEntity} />,
                form: <FormView entity={activeEntity} entityDrafts={entityDrafts} setEntityDrafts={setEntityDrafts} onCreateRecord={handleCreateRecord} busyEntity={busyEntity} formError={formError} />,
                csvImport: <CsvImportView entity={activeEntity} activeImport={activeImport} onChangeImport={setActiveImport} onImportCsv={handleImportCsv} busyEntity={busyEntity} headers={importHeaders} rows={importRows} mapping={importMapping} />,
                notifications: <NotificationsView token={token} currentUser={currentUser} notifications={notifications} onMarkRead={handleMarkNotificationsRead} />,
              }[activePage.component] || <UnknownRenderer page={activePage} config={config} t={t} />
            ) : (
              <EmptyState title="No pages found" message="The config did not define any pages." />
            )}
          </Panel>
        </main>
      </section>
    </div>
  )
}

function DashboardView({ entity, entityLists, dashboardMetrics, locale, t }) {
  const recentRecords = entity ? entityLists[entity.name] || [] : []
  return (
    <div className="generated-grid">
      <div className="card-panel">
        <h3>{t('dashboard')}</h3>
        <p>{formatValue(dashboardMetrics.total)} total records across the generated schema.</p>
        <div className="mini-metrics">
          {dashboardMetrics.counts.map((entry) => (
            <article key={entry.entity.name} className="mini-metric">
              <strong>{entry.count}</strong>
              <span>{entry.entity.label}</span>
            </article>
          ))}
        </div>
      </div>
      <div className="card-panel">
        <h3>Recent {entity?.label || 'records'}</h3>
        {recentRecords.slice(0, 3).length > 0 ? (
          <ul className="record-list">
            {recentRecords.slice(0, 3).map((record) => (
              <li key={record.id}>
                <strong>{record.name || record.title || record.email || record.id}</strong>
                <span>{record.segment || record.status || record.amount || formatValue(record.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyInline message="No records yet for this entity." />
        )}
      </div>
      <div className="card-panel accent-card">
        <h3>Localization</h3>
        <p>The runtime currently uses {locale.toUpperCase()} and falls back to English when translations are missing.</p>
      </div>
    </div>
  )
}

function TableView({ entity, entityLists, onDeleteRecord, busyEntity }) {
  const records = entity ? entityLists[entity.name] || [] : []
  if (!entity) {
    return <EmptyState title="No entity bound" message="This page has no matching database entity." />
  }
  const columns = entity.fields
  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.name}>{column.label}</th>
            ))}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.length > 0 ? (
            records.map((record) => (
              <tr key={record.id}>
                {columns.map((column) => (
                  <td key={column.name}>{formatValue(record[column.name])}</td>
                ))}
                <td>
                  <button type="button" className="ghost-button compact" onClick={() => onDeleteRecord(entity.name, record.id)} disabled={busyEntity === entity.name}>
                    Delete
                  </button>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length + 1}>
                <EmptyInline message={`No ${entity.label.toLowerCase()} records exist yet.`} />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function FormView({ entity, entityDrafts, setEntityDrafts, onCreateRecord, busyEntity, formError }) {
  if (!entity) {
    return <EmptyState title="No entity bound" message="The current page does not resolve to an entity." />
  }
  const draft = entityDrafts[entity.name] || createEmptyFormState(entity)
  return (
    <div className="generated-form-grid">
      <form
        className="form-card"
        onSubmit={(event) => {
          event.preventDefault()
          void onCreateRecord(entity.name, draft)
        }}
      >
        <div className="form-header">
          <div>
            <h3>{entity.label}</h3>
            <p>{entity.description}</p>
          </div>
          <span className="badge">{busyEntity === entity.name ? 'Saving...' : 'Ready'}</span>
        </div>
        <div className="field-grid">
          {buildFieldOptions(entity).map((field) => (
            <GeneratedField
              key={field.name}
              field={field}
              value={draft[field.name]}
              onChange={(nextValue) =>
                setEntityDrafts((previous) => ({
                  ...previous,
                  [entity.name]: {
                    ...(previous[entity.name] || {}),
                    [field.name]: nextValue,
                  },
                }))
              }
            />
          ))}
        </div>
        {formError ? <InlineNotice status="error" message={formError} /> : null}
        <button type="submit" className="primary-button" disabled={busyEntity === entity.name}>
          Create {entity.label}
        </button>
      </form>
      <div className="card-panel">
        <h3>How it works</h3>
        <p>This form is generated from config. Fields can be added to the JSON schema without changing the renderer.</p>
        <p>Optional fields, enums, and fallback values are normalized by the runtime before persistence.</p>
      </div>
    </div>
  )
}

function CsvImportView({ entity, activeImport, onChangeImport, onImportCsv, busyEntity, headers, rows, mapping }) {
  if (!entity) {
    return <EmptyState title="No entity bound" message="The import page has no target entity." />
  }
  return (
    <div className="generated-form-grid">
      <section className="form-card">
        <div className="form-header">
          <div>
            <h3>CSV Import</h3>
            <p>Upload, map, and store rows for {entity.label}.</p>
          </div>
          <span className="badge">CSV</span>
        </div>
        <label className="field-label" htmlFor="csv-text">CSV payload</label>
        <textarea id="csv-text" className="config-editor csv-editor" value={activeImport.csvText} onChange={(event) => onChangeImport((previous) => ({ ...previous, csvText: event.target.value, result: null }))} />
        <div className="mapping-grid">
          {headers.map((header) => (
            <label key={header} className="mapping-row">
              <span>{header}</span>
              <select
                value={mapping[header] || ''}
                onChange={(event) =>
                  onChangeImport((previous) => ({
                    ...previous,
                    mapping: {
                      ...mapping,
                      [header]: event.target.value,
                    },
                  }))
                }
              >
                <option value="">Ignore</option>
                {entity.fields.map((field) => (
                  <option key={field.name} value={field.name}>
                    {field.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <button type="button" className="primary-button" onClick={onImportCsv} disabled={busyEntity === 'import'}>
          Import records
        </button>
        <p className="muted">Parsed rows: {rows.length}</p>
        {activeImport.result ? (
          <InlineNotice
            status="success"
            message={`Imported ${activeImport.result.created.length} rows. ${activeImport.result.errors.length ? `${activeImport.result.errors.length} rows failed validation.` : 'All rows processed successfully.'}`}
          />
        ) : null}
      </section>
      <section className="card-panel">
        <h3>Mapping preview</h3>
        <pre className="preview-code">{JSON.stringify(mapping, null, 2)}</pre>
      </section>
    </div>
  )
}

function NotificationsView({ token, currentUser, notifications, onMarkRead }) {
  return (
    <div className="card-panel">
      <div className="form-header">
        <div>
          <h3>Notifications</h3>
          <p>{currentUser ? 'Notifications are tied to the signed-in user and mirrored as transactional events.' : 'Sign in to receive scoped notifications.'}</p>
        </div>
        <button type="button" className="ghost-button compact" onClick={onMarkRead} disabled={!token}>
          Mark read
        </button>
      </div>
      <p className="muted">Token status: {token ? 'active' : 'missing'}</p>
      <ul className="notification-list">
        {notifications.length > 0 ? (
          notifications.slice(0, 6).map((notification) => (
            <li key={notification.id} className={notification.readAt ? 'read' : 'unread'}>
              <strong>{notification.title}</strong>
              <span>{notification.message}</span>
            </li>
          ))
        ) : (
          <li>
            <span>No notifications yet.</span>
          </li>
        )}
      </ul>
    </div>
  )
}

function UnknownRenderer({ page, config, t }) {
  return (
    <div className="unknown-panel">
      <h3>{t('unknownComponent')}</h3>
      <p>
        The page component <strong>{page.component}</strong> is not registered yet. This is the fallback path for inconsistent configs.
      </p>
      <pre className="preview-code">{JSON.stringify(page, null, 2)}</pre>
      <p className="muted">You can extend the registry by adding a new renderer without changing the runtime contract.</p>
      <p className="muted">Known app: {config?.app?.name}</p>
    </div>
  )
}

function GeneratedField({ field, value, onChange }) {
  if (field.type === 'textarea') {
    return (
      <label className="field">
        <span>{field.label}</span>
        <textarea value={value} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />
      </label>
    )
  }
  if (field.type === 'enum') {
    return (
      <label className="field">
        <span>{field.label}</span>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select...</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    )
  }
  return (
    <label className="field">
      <span>{field.label}</span>
      <input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text'} value={value} placeholder={field.placeholder} onChange={(event) => onChange(field.type === 'number' ? Number(event.target.value) : event.target.value)} />
    </label>
  )
}

function AuthPanel({ authState, onChange, onSubmit, onLogout, onToggleMode, currentUser, token, message }) {
  return (
    <div className="stack auth-stack">
      <div className="mode-switch">
        {['login', 'register', 'magic', 'verify'].map((mode) => (
          <button key={mode} type="button" className={authState.mode === mode ? 'mode-button active' : 'mode-button'} onClick={() => onToggleMode(mode)}>
            {mode}
          </button>
        ))}
      </div>
      <form className="stack" onSubmit={onSubmit}>
        {authState.mode === 'register' ? (
          <label className="field-label">
            Display name
            <input value={authState.displayName} onChange={(event) => onChange((previous) => ({ ...previous, displayName: event.target.value }))} />
          </label>
        ) : null}
        <label className="field-label">
          Email
          <input value={authState.email} onChange={(event) => onChange((previous) => ({ ...previous, email: event.target.value }))} />
        </label>
        {authState.mode !== 'magic' ? (
          <label className="field-label">
            {authState.mode === 'verify' ? 'Magic code' : 'Password'}
            <input type="text" value={authState.password} onChange={(event) => onChange((previous) => ({ ...previous, password: event.target.value }))} />
          </label>
        ) : null}
        <button type="submit" className="primary-button">Submit</button>
      </form>
      <div className="auth-footer">
        {currentUser ? <span className="badge success">{currentUser.displayName}</span> : <span className="badge">Signed out</span>}
        {token ? <button type="button" className="ghost-button compact" onClick={onLogout}>Logout</button> : null}
      </div>
      {message ? <InlineNotice status={message.toLowerCase().includes('error') ? 'error' : 'success'} message={message} /> : null}
    </div>
  )
}

function LocaleSwitcher({ locale, locales, onChange, label }) {
  return (
    <label className="locale-switcher">
      <span>{label}</span>
      <select value={locale} onChange={(event) => onChange(event.target.value)}>
        {locales.map((item) => (
          <option key={item} value={item}>
            {item.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  )
}

function Panel({ title, children, tone = 'default' }) {
  return (
    <section className={`panel panel-${tone}`}>
      <div className="panel-heading">
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  )
}

function StatCard({ label, value, hint }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{hint}</p>
    </article>
  )
}

function NotificationList({ notifications }) {
  if (!notifications.length) {
    return <EmptyInline message="No notifications yet. Actions like auth, CRUD, and imports will appear here." />
  }
  return (
    <ul className="notification-list">
      {notifications.slice(0, 5).map((notification) => (
        <li key={notification.id} className={notification.readAt ? 'read' : 'unread'}>
          <strong>{notification.title}</strong>
          <span>{notification.message}</span>
        </li>
      ))}
    </ul>
  )
}

function WarningList({ warnings }) {
  return (
    <ul className="warning-list">
      {warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  )
}

function InlineNotice({ status, message }) {
  return <div className={`inline-notice ${status}`}>{message}</div>
}

function EmptyState({ title, message }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  )
}

function EmptyInline({ message }) {
  return <div className="empty-inline">{message}</div>
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="error-state">
      <h1>Runtime error</h1>
      <p>{message}</p>
      <button type="button" className="primary-button" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}

function LoadingState({ label }) {
  return (
    <div className="loading-state">
      <div className="loading-orb" />
      <h1>{label}</h1>
      <p>Booting the generated runtime and resolving the current config.</p>
    </div>
  )
}

function parseCsvHeaders(csvText) {
  const line = String(csvText || '').split(/\r?\n/)[0] || ''
  return line
    .split(',')
    .map((header) => header.trim())
    .filter(Boolean)
}

function parseCsvRows(csvText) {
  const lines = String(csvText || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(Boolean)
  if (lines.length <= 1) {
    return []
  }
  const headers = lines[0].split(',').map((item) => item.trim())
  return lines.slice(1).map((line) => {
    const values = line.split(',')
    return headers.reduce((row, header, index) => {
      row[header] = values[index]?.trim() || ''
      return row
    }, {})
  })
}

function inferMapping(headers, entity) {
  const options = buildFieldOptions(entity)
  return headers.reduce((mapping, header) => {
    const normalized = header.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const match = options.find((field) => field.name.toLowerCase().replace(/[^a-z0-9]+/g, '') === normalized || field.label.toLowerCase().replace(/[^a-z0-9]+/g, '') === normalized)
    mapping[header] = match?.name || ''
    return mapping
  }, {})
}

export default App