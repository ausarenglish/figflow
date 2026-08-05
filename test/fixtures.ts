// One fixed review file, shared by the snapshot tests. Every value is
// hard-coded: a packet that varies run to run is a packet an agent cannot be
// given twice, so these tests exist to pin the output byte for byte.

import type { FigmaComment } from '../src/adapters/figma/read.ts'
import type { Config } from '../src/config.ts'
import type { Routes } from '../src/routes.ts'

export const FIXTURE_KEY = 'Xm9FF9sYw7npqhFOIi41Ue'

export const FIXTURE_CONFIG: Config = {
  fileKey: FIXTURE_KEY,
  fileName: 'Oonee WebApp 2026 - Flow review',
  fileType: 'board',
  preview: { baseUrl: 'https://oonee-mvp-git-{branch}-oonee.vercel.app' },
}

export const FIXTURE_ROUTES: Routes = {
  '2:327': '/bookings',
  '2:406': '/providers',
}

function comment(over: Partial<FigmaComment> & { id: string }): FigmaComment {
  return {
    file_key: FIXTURE_KEY,
    parent_id: '',
    user: { id: 'u1', handle: 'Sara Linares' },
    created_at: '2026-07-28T09:00:00Z',
    resolved_at: null,
    message: 'placeholder',
    order_id: '1',
    client_meta: { node_id: '2:327' },
    ...over,
  }
}

/** Shaped after the real Oonee board: two frames, a reply, an unanchored note. */
export const FIXTURE_COMMENTS: FigmaComment[] = [
  comment({
    id: '1858203401',
    message: 'Add an option to cancel a booking.',
    created_at: '2026-07-28T09:00:00Z',
  }),
  comment({
    id: '1858203148',
    message: "It's there a way to edit a booking after?",
    created_at: '2026-07-28T09:05:00Z',
  }),
  comment({
    id: '9001',
    parent_id: '1858203148',
    user: { id: 'u2', handle: 'Marco' },
    message: 'Editing matters more than cancelling for us.',
    created_at: '2026-07-29T11:00:00Z',
  }),
  comment({
    id: '1858204600',
    user: { id: 'u2', handle: 'Marco' },
    message: 'Add more data to the provider profile:\nhours, location, phone.',
    created_at: '2026-07-30T08:00:00Z',
    client_meta: { node_id: '2:406' },
  }),
  comment({
    id: '1858199014',
    message: 'Add some pop ups like reminders',
    created_at: '2026-07-31T14:00:00Z',
    client_meta: { x: 10, y: 20 },
  }),
]

export const FIXTURE_ANCHORS: Record<string, { name: string; type: string }> = {
  '2:327': { name: 'image 3', type: 'RECTANGLE' },
  '2:406': { name: 'image 6', type: 'RECTANGLE' },
}

export const FIXTURE_NOW = '2026-08-05T12:00:00Z'
