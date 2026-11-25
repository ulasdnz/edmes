import { randomBytes } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'

// Everything is created through the public API as the system admin, under names of its own, so a
// run works on a stack that already holds the data of earlier runs and changes nothing it did not
// create.

export interface Credentials {
  email: string
  password: string
}

export interface Seed {
  admin: Credentials & { token: string }
  viewer: Credentials // the ready-made Viewer role
  limited: Credentials // a role this seed creates with accessWebApp only
  operator: Credentials // the ready-made Operator role, assigned to workCenter
  unassignedOperator: Credentials // the ready-made Operator role, no work center
  workCenter: { _id: string; name: string }
  // What startJobOrder needs to make a job order for workCenter
  productId: string
}

type Created = { _id: string }

// Enough users for /users?page=2&size=50 to have a second page
const MIN_USERS = 51

export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
}

export function adminCredentials(): Credentials {
  const email = process.env.SYSTEM_ADMIN_EMAIL
  const password = process.env.SYSTEM_ADMIN_PASSWORD
  if (!email || !password) {
    throw new Error('SYSTEM_ADMIN_EMAIL and SYSTEM_ADMIN_PASSWORD must be set (the root .env)')
  }
  return { email, password }
}

export async function call<T>(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  token: string | undefined,
  body?: unknown,
): Promise<T> {
  const response = await request.fetch(path, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    data: body,
  })
  const text = await response.text()
  if (!response.ok()) {
    throw new Error(`${method} ${path} answered ${response.status()}: ${text}`)
  }
  return (JSON.parse(text) as { data: T }).data
}

export async function login(request: APIRequestContext, credentials: Credentials) {
  return call<{ token: string; user: Created }>(
    request,
    'POST',
    '/api/v1/auth/login',
    undefined,
    credentials,
  )
}

export async function createUser(
  request: APIRequestContext,
  token: string,
  input: { label: string; roleIds: string[]; workCenterIds?: string[] },
): Promise<Credentials & { _id: string }> {
  const suffix = uniqueSuffix()
  const email = `e2e.${input.label}.${suffix}@example.test`
  const password = `E2e-${randomBytes(6).toString('hex')}`
  const user = await call<Created>(request, 'POST', '/api/v1/users', token, {
    username: `e2e.${input.label}.${suffix}`.slice(0, 30),
    name: 'E2E',
    surname: input.label,
    email,
    password,
    roles: input.roleIds,
    workCenterIds: input.workCenterIds ?? [],
  })
  return { _id: user._id, email, password }
}

export async function readyMadeRoleId(
  request: APIRequestContext,
  token: string,
  key: 'operator' | 'viewer',
): Promise<string> {
  const roles = await call<Array<Created & { key?: string }>>(
    request,
    'GET',
    '/api/v1/roles?limit=100',
    token,
  )
  const role = roles.find(candidate => candidate.key === key)
  if (!role) throw new Error(`the ready-made role ${key} does not exist`)
  return role._id
}

// A count based work center with its signals and a product it can make, as
// e2e/src/oee.e2e.test.ts builds one.
export async function createWorkCenter(request: APIRequestContext, token: string) {
  const code = `E2E-${uniqueSuffix().toUpperCase()}`
  const deviceKey = code.toLowerCase()
  const post = <T = Created>(path: string, body: unknown) =>
    call<T>(request, 'POST', path, token, body)

  const tagType = await post('/api/v1/tag-types', { name: `${code} signals` })
  const counter = await post('/api/v1/tags', {
    name: `${code} strokes`,
    tagTypeId: tagType._id,
    behavior: 'counter',
    binding: { deviceKey, nodeId: 'strokes' },
  })
  const runMode = await post('/api/v1/tags', {
    name: `${code} run mode`,
    tagTypeId: tagType._id,
    behavior: 'binary',
    binding: { deviceKey, nodeId: 'run' },
  })
  const shift = await post('/api/v1/shifts', {
    name: `${code} day`,
    startHour: 0,
    startMinute: 0,
    endHour: 23,
    endMinute: 59,
  })
  const name = `E2E station ${code}`
  const workCenter = await post('/api/v1/work-centers', {
    code,
    name,
    type: 'physical',
    productivityMode: 'count_based',
    tagBindings: { runModeTagId: runMode._id, productionCounterTagId: counter._id },
    shiftIds: [shift._id],
  })
  const uom = await post('/api/v1/uoms', {
    code: `${code}-PCS`,
    name: `${code} piece`,
    symbol: 'pcs',
  })
  const product = await post('/api/v1/products', {
    code: `${code}-PART`,
    name: `${code} part`,
    kind: 'finished',
    uomId: uom._id,
  })
  await post('/api/v1/product-standards', {
    productId: product._id,
    workCenterId: workCenter._id,
    validFrom: new Date(Date.now() - 3_600_000).toISOString(),
    idealOutputPerMinute: 40,
    counterMultiplier: 4,
  })
  return { workCenter: { _id: workCenter._id, name }, productId: product._id }
}

async function ensureUsers(request: APIRequestContext, token: string, roleId: string) {
  const { pagination } = await request
    .get('/api/v1/users?limit=1', { headers: { authorization: `Bearer ${token}` } })
    .then(response => response.json() as Promise<{ pagination: { total: number } }>)
  for (let count = pagination.total; count < MIN_USERS; count++) {
    await createUser(request, token, { label: 'filler', roleIds: [roleId] })
  }
}

export async function seed(request: APIRequestContext): Promise<Seed> {
  const credentials = adminCredentials()
  const { token } = await login(request, credentials)
  const viewerRole = await readyMadeRoleId(request, token, 'viewer')
  const operatorRole = await readyMadeRoleId(request, token, 'operator')
  const limitedRole = await call<Created>(request, 'POST', '/api/v1/roles', token, {
    name: `E2E web only ${uniqueSuffix()}`,
    permissions: ['accessWebApp'],
  })
  const { workCenter, productId } = await createWorkCenter(request, token)

  const viewer = await createUser(request, token, { label: 'viewer', roleIds: [viewerRole] })
  const limited = await createUser(request, token, {
    label: 'limited',
    roleIds: [limitedRole._id],
  })
  const operator = await createUser(request, token, {
    label: 'operator',
    roleIds: [operatorRole],
    workCenterIds: [workCenter._id],
  })
  const unassignedOperator = await createUser(request, token, {
    label: 'unassigned',
    roleIds: [operatorRole],
  })
  await ensureUsers(request, token, viewerRole)

  const strip = ({ email, password }: Credentials) => ({ email, password })
  return {
    admin: { ...credentials, token },
    viewer: strip(viewer),
    limited: strip(limited),
    operator: strip(operator),
    unassignedOperator: strip(unassignedOperator),
    workCenter,
    productId,
  }
}

export async function startJobOrder(
  request: APIRequestContext,
  seed: Seed,
): Promise<{ code: string }> {
  const code = `JO-${uniqueSuffix().toUpperCase()}`
  const jobOrder = await call<Created>(request, 'POST', '/api/v1/job-orders', seed.admin.token, {
    code,
    productId: seed.productId,
    workCenterId: seed.workCenter._id,
    targetQuantity: 1000,
  })
  await call(request, 'POST', `/api/v1/job-orders/${jobOrder._id}/start`, seed.admin.token, {
    startTime: new Date().toISOString(),
  })
  return { code }
}
