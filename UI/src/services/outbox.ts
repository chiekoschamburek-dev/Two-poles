import { readOutbox, writeOutbox } from '@/services/storage'
import { newId } from '@/utils/id'

export type OutboxKind =
  | 'profile.update'
  | 'privacy.update'
  | 'session.create'
  | 'session.feedback'
  | 'session.delete'
  | 'meal.create'
  | 'meal.update'
  | 'meal.delete'
  | 'plan.create'
  | 'plan.adjustment'
  | 'analysis.create'
  | 'analysis.update'
  | 'analysis.delete'

export interface OutboxOp {
  id: string
  kind: OutboxKind
  clientId: string
  payload: unknown
  createdAt: string
  attempts: number
  nextAt: string
  status: 'pending' | 'failed'
  error?: string
}

function read(): OutboxOp[] {
  return readOutbox<OutboxOp>().filter((op) => op && typeof op.id === 'string' && typeof op.kind === 'string')
}

function write(ops: OutboxOp[]) {
  if (!writeOutbox(ops)) throw new Error('同步队列写入失败，请先导出数据并清理浏览器存储后重试')
}

const inFlight = new Set<string>()
export function setOpInFlight(id: string, active: boolean) {
  if (active) inFlight.add(id)
  else inFlight.delete(id)
}

function sameResource(op: OutboxOp, kind: OutboxKind, clientId: string): boolean {
  return op.kind === kind && op.clientId === clientId
}

export function listOutbox(): OutboxOp[] {
  return read().sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function enqueue(kind: OutboxKind, clientId: string, payload: unknown): OutboxOp {
  const now = new Date().toISOString()
  const ops = read()
  let filtered = ops
  if (kind === 'session.feedback') {
    const create = ops.find((op) => op.kind === 'session.create' && op.clientId === clientId && !inFlight.has(op.id))
    if (create) {
      const next = payload as { session?: unknown }
      if (next.session) create.payload = next.session
      create.createdAt = now
      create.status = 'pending'
      create.attempts = 0
      create.error = undefined
      create.nextAt = now
      write(ops)
      return create
    }
  }
  if (kind === 'meal.update') {
    const create = ops.find((op) => op.kind === 'meal.create' && op.clientId === clientId && !inFlight.has(op.id))
    if (create) {
      create.payload = payload
      create.createdAt = now
      create.status = 'pending'
      create.attempts = 0
      create.error = undefined
      create.nextAt = now
      write(ops)
      return create
    }
  }
  if (kind === 'analysis.update') {
    const create = ops.find((op) => op.kind === 'analysis.create' && op.clientId === clientId && !inFlight.has(op.id))
    if (create) {
      create.payload = payload
      create.createdAt = now
      create.status = 'pending'
      create.attempts = 0
      create.error = undefined
      create.nextAt = now
      write(ops)
      return create
    }
  }
  if (kind === 'profile.update' || kind === 'privacy.update') {
    filtered = ops.filter((op) => op.kind !== kind)
  } else if (kind === 'session.feedback' || kind === 'meal.update' || kind === 'analysis.update') {
    filtered = ops.filter((op) => !sameResource(op, kind, clientId))
  } else if (kind === 'session.create' || kind === 'meal.create' || kind === 'plan.create' || kind === 'analysis.create') {
    filtered = ops.filter((op) => !sameResource(op, kind, clientId))
  } else if (kind === 'session.delete') {
    filtered = ops.filter((op) => !(op.clientId === clientId && (op.kind === 'session.create' || op.kind === 'session.feedback')))
  } else if (kind === 'meal.delete') {
    filtered = ops.filter((op) => !(op.clientId === clientId && (op.kind === 'meal.create' || op.kind === 'meal.update')))
  } else if (kind === 'analysis.delete') {
    filtered = ops.filter((op) => !(op.clientId === clientId && (op.kind === 'analysis.create' || op.kind === 'analysis.update')))
  }
  const op: OutboxOp = {
    id: newId(),
    kind,
    clientId,
    payload,
    createdAt: now,
    attempts: 0,
    nextAt: now,
    status: 'pending'
  }
  filtered.push(op)
  write(filtered)
  return op
}

export function removeOp(id: string) {
  write(read().filter((op) => op.id !== id))
}

export function updateOp(id: string, patch: Partial<OutboxOp>) {
  write(read().map((op) => op.id === id ? { ...op, ...patch } : op))
}

export function clearOutbox() {
  write([])
}

export function pendingCount(): number {
  return read().filter((op) => op.status === 'pending').length
}
