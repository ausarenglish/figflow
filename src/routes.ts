import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { frameLabel, type State } from './state.ts'

/** node id → the app path that frame corresponds to. Hand-written, once. */
export type Routes = Record<string, string>

export function routesPath(root: string): string {
  return join(root, '.figflow', 'routes.json')
}

export function loadRoutes(root: string): Routes {
  const path = routesPath(root)
  if (!existsSync(path)) return {}
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  const out: Routes = {}
  for (const [nodeId, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value.trim()) out[nodeId] = value.trim()
  }
  return out
}

/**
 * Write a stub containing every frame that currently has a comment on it,
 * preserving any paths already filled in. Frame names ride along as `//` keys
 * so the file is readable while you complete it.
 */
export function writeStub(root: string, state: State): { total: number; filled: number } {
  const existing = loadRoutes(root)
  const anchored = [
    ...new Set(
      Object.values(state.threads)
        .filter((t) => t.status !== 'gone' && t.nodeId)
        .map((t) => t.nodeId as string),
    ),
  ].sort((a, b) => frameLabel(state, a).localeCompare(frameLabel(state, b)))

  const lines = ['{']
  anchored.forEach((nodeId, i) => {
    const comma = i === anchored.length - 1 ? '' : ','
    // The node id rides in the label too: FigJam frames are often all called
    // "Shape with text", and duplicate JSON keys are not worth shipping.
    lines.push(`  "// ${frameLabel(state, nodeId)}  ${nodeId}": "",`)
    lines.push(`  ${JSON.stringify(nodeId)}: ${JSON.stringify(existing[nodeId] ?? '')}${comma}`)
  })
  lines.push('}')

  mkdirSync(join(root, '.figflow'), { recursive: true })
  writeFileSync(routesPath(root), lines.join('\n') + '\n')

  return { total: anchored.length, filled: anchored.filter((id) => existing[id]).length }
}
