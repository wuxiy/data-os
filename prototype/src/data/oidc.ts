export type AuthSnapshot = {
  status: 'disabled' | 'loading' | 'authenticated' | 'unauthenticated' | 'error'
  displayName?: string
  roles?: string[]
  error?: string
}

type OidcMetadata = {
  authorization_endpoint: string
  token_endpoint: string
  end_session_endpoint?: string
}

type TokenResponse = {
  access_token: string
  token_type?: string
  expires_in?: number
  id_token?: string
}

type StoredSession = {
  accessToken: string
  expiresAt: number
  displayName?: string
  roles?: string[]
}

const issuer = String(import.meta.env.VITE_DATAOS_OIDC_ISSUER_URI ?? '').replace(/\/$/, '')
const clientId = String(import.meta.env.VITE_DATAOS_OIDC_CLIENT_ID ?? '').trim()
const configuredRedirectUri = String(import.meta.env.VITE_DATAOS_OIDC_REDIRECT_URI ?? '').trim()
const sessionKey = 'dataos.oidc.session'
const stateKey = 'dataos.oidc.state'
const verifierKey = 'dataos.oidc.pkce-verifier'
let metadataPromise: Promise<OidcMetadata> | undefined
const technicalRoles = new Set(['data-engineer', 'platform-operator', 'platform-admin'])

export function oidcIsConfigured(): boolean {
  return Boolean(issuer && clientId)
}

export function getAccessToken(): string | undefined {
  if (!oidcIsConfigured()) return undefined
  const session = readSession()
  if (!session) return undefined
  if (session.expiresAt <= Date.now() + 30_000) {
    clearOidcSession()
    return undefined
  }
  return session.accessToken
}

export function clearOidcSession(): void {
  sessionStorage.removeItem(sessionKey)
}

export function getOidcDisplayName(): string | undefined {
  return readSession()?.displayName
}

export function hasTechnicalAccess(snapshot: Pick<AuthSnapshot, 'status' | 'roles'>): boolean {
  if (!oidcIsConfigured()) {
    return String(import.meta.env.VITE_DATAOS_TECHNICAL_ACCESS ?? 'true').toLowerCase() !== 'false'
  }
  return snapshot.status === 'authenticated'
    && (snapshot.roles ?? []).some(role => technicalRoles.has(role.toLowerCase()))
}

export async function initializeOidc(): Promise<AuthSnapshot> {
  if (!oidcIsConfigured()) return { status: 'disabled' }
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.has('error')) {
      const message = params.get('error_description') || params.get('error') || 'OIDC 登录被取消'
      replaceCallbackUrl()
      return { status: 'error', error: message }
    }
    if (params.get('code')) await completeLogin(params)
    const session = readSession()
    if (!session || !getAccessToken()) return { status: 'unauthenticated' }
    const roles = session.roles?.length ? session.roles : extractRoles(decodeJwtClaims(session.accessToken))
    if (!session.roles?.length && roles.length) {
      sessionStorage.setItem(sessionKey, JSON.stringify({ ...session, roles } satisfies StoredSession))
    }
    return { status: 'authenticated', displayName: session.displayName, roles }
  } catch (error) {
    clearOidcSession()
    replaceCallbackUrl()
    return { status: 'error', error: error instanceof Error ? error.message : 'OIDC 登录失败' }
  }
}

export async function startOidcLogin(): Promise<void> {
  const metadata = await getMetadata()
  const state = randomString(32)
  const verifier = randomString(64)
  sessionStorage.setItem(stateKey, state)
  sessionStorage.setItem(verifierKey, verifier)
  const challenge = await base64UrlDigest(verifier)
  const redirectUri = getRedirectUri()
  const authorization = new URL(metadata.authorization_endpoint)
  authorization.searchParams.set('client_id', clientId)
  authorization.searchParams.set('redirect_uri', redirectUri)
  authorization.searchParams.set('response_type', 'code')
  authorization.searchParams.set('scope', 'openid profile email')
  authorization.searchParams.set('state', state)
  authorization.searchParams.set('code_challenge', challenge)
  authorization.searchParams.set('code_challenge_method', 'S256')
  window.location.assign(authorization.toString())
}

export function logoutOidc(): void {
  clearOidcSession()
  sessionStorage.removeItem(stateKey)
  sessionStorage.removeItem(verifierKey)
  window.location.replace(window.location.pathname)
}

async function completeLogin(params: URLSearchParams): Promise<void> {
  const expectedState = sessionStorage.getItem(stateKey)
  const verifier = sessionStorage.getItem(verifierKey)
  if (!expectedState || expectedState !== params.get('state')) throw new Error('OIDC state 校验失败，请重新登录')
  if (!verifier) throw new Error('OIDC PKCE 会话已过期，请重新登录')
  const metadata = await getMetadata()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code: params.get('code') ?? '',
    redirect_uri: getRedirectUri(),
    code_verifier: verifier,
  })
  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) throw new Error(`OIDC token 交换失败（HTTP ${response.status}）`)
  const token = await response.json() as TokenResponse
  if (!token.access_token) throw new Error('OIDC token 响应缺少 access_token')
  const idClaims = token.id_token ? decodeJwtClaims(token.id_token) : {}
  const accessClaims = decodeJwtClaims(token.access_token)
  const displayName = String(idClaims.preferred_username ?? idClaims.name ?? idClaims.email ?? '').trim() || undefined
  const roles = extractRoles({ ...accessClaims, ...idClaims })
  sessionStorage.setItem(sessionKey, JSON.stringify({
    accessToken: token.access_token,
    expiresAt: Date.now() + Math.max(60, token.expires_in ?? 300) * 1000,
    displayName,
    roles,
  } satisfies StoredSession))
  sessionStorage.removeItem(stateKey)
  sessionStorage.removeItem(verifierKey)
  replaceCallbackUrl()
}

function readSession(): StoredSession | undefined {
  try {
    const value = sessionStorage.getItem(sessionKey)
    if (!value) return undefined
    const parsed = JSON.parse(value) as Partial<StoredSession>
    if (typeof parsed.accessToken !== 'string' || typeof parsed.expiresAt !== 'number') return undefined
    return parsed as StoredSession
  } catch {
    clearOidcSession()
    return undefined
  }
}

async function getMetadata(): Promise<OidcMetadata> {
  metadataPromise ??= fetch(`${issuer}/.well-known/openid-configuration`, { headers: { Accept: 'application/json' } })
    .then(async response => {
      if (!response.ok) throw new Error(`OIDC discovery 失败（HTTP ${response.status}）`)
      return response.json() as Promise<OidcMetadata>
    })
  return metadataPromise
}

function getRedirectUri(): string {
  return configuredRedirectUri || `${window.location.origin}${window.location.pathname}`
}

function replaceCallbackUrl(): void {
  const cleanUrl = `${window.location.pathname}${window.location.hash}`
  window.history.replaceState({}, document.title, cleanUrl)
}

function randomString(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

async function base64UrlDigest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return base64Url(new Uint8Array(digest))
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeJwtClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1]
    if (!payload) return {}
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))) as Record<string, unknown>
  } catch {
    return {}
  }
}

function extractRoles(claims: Record<string, unknown>): string[] {
  const roles = new Set<string>()
  addRoleValues(roles, claims.roles)
  addRoleValues(roles, claims.groups)
  if (isRecord(claims.realm_access)) addRoleValues(roles, claims.realm_access.roles)
  if (isRecord(claims.resource_access)) {
    Object.values(claims.resource_access).forEach(value => {
      if (isRecord(value)) addRoleValues(roles, value.roles)
    })
  }
  return [...roles]
}

function addRoleValues(target: Set<string>, value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(item => addRoleValues(target, item))
    return
  }
  if (typeof value !== 'string') return
  value.split(/[\s,]+/).map(item => item.trim().toLowerCase().replace(/^role_/, ''))
    .filter(Boolean).forEach(item => target.add(item))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
