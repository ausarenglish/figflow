// Resolving a config to an adapter. A switch, not a plugin system: adding a
// source means writing one module and adding one case here.

import type { Config } from '../config.ts'
import { figmaSource } from './figma/read.ts'
import { figmaWriter } from './figma/write.ts'
import type { ReviewSource, ReviewWriter, SourceKind } from './types.ts'

export function sourceKind(config: Config): SourceKind {
  return config.source ?? 'figma'
}

export function openSource(config: Config, token: string): ReviewSource {
  switch (sourceKind(config)) {
    case 'figma':
      return figmaSource(
        config.fileKey,
        config.fileType ?? 'design',
        config.fileName ?? config.fileKey,
        token,
      )
    default:
      throw new Error(`Unknown review source "${sourceKind(config)}" in .figflow/config.json`)
  }
}

/**
 * Separate from openSource on purpose. A module that only reads cannot obtain a
 * writer by accident — it has to import this function by name.
 */
export function openWriter(config: Config, token: string): ReviewWriter {
  switch (sourceKind(config)) {
    case 'figma':
      return figmaWriter(config.fileKey, token)
    default:
      throw new Error(`Unknown review source "${sourceKind(config)}" in .figflow/config.json`)
  }
}
