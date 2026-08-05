import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toThreads, type FigmaComment } from '../src/adapters/figma/read.ts'
import { commentUrl, parseFileKey, parseFileUrl } from '../src/adapters/figma/url.ts'

const KEY = 'Xm9FF9sYw7npqhFOIi41Ue'

test('reads the key and the editor type out of a FigJam board URL', () => {
  const url = `https://www.figma.com/board/${KEY}/Oonee-WebApp-2026---Flow-review?node-id=0-1&t=abc`
  assert.deepEqual(parseFileUrl(url), { fileKey: KEY, fileType: 'board' })
})

test('a design file URL is a design file', () => {
  assert.deepEqual(parseFileUrl(`https://www.figma.com/design/${KEY}/Oonee`), {
    fileKey: KEY,
    fileType: 'design',
  })
})

test('legacy /file/ and /proto/ links resolve to design', () => {
  assert.equal(parseFileUrl(`https://www.figma.com/file/${KEY}/x`).fileType, 'design')
  assert.equal(parseFileUrl(`https://www.figma.com/proto/${KEY}/x`).fileType, 'design')
})

test('a bare key is assumed to be a design file', () => {
  assert.deepEqual(parseFileUrl(KEY), { fileKey: KEY, fileType: 'design' })
})

test('parseFileKey still returns just the key', () => {
  assert.equal(parseFileKey(`https://www.figma.com/board/${KEY}/x`), KEY)
})

test('a garbage input is rejected rather than guessed at', () => {
  assert.throws(() => parseFileUrl('not a figma url'))
})

// The whole point of the reply is that the designer clicks it. A board comment
// linked under /design/ is a link that does not open the file it belongs to.
test('a comment on a board links to /board/, not /design/', () => {
  assert.equal(
    commentUrl(KEY, '99', '1:2', 'board'),
    `https://www.figma.com/board/${KEY}/?node-id=1-2#99`,
  )
})

test('an unanchored comment carries no node-id fragment', () => {
  assert.equal(commentUrl(KEY, '99', null, 'board'), `https://www.figma.com/board/${KEY}/#99`)
})

test('threads built from a board carry board URLs through to state', () => {
  const raw: FigmaComment[] = [
    {
      id: '7',
      file_key: KEY,
      parent_id: '',
      user: { id: 'u1', handle: 'sara' },
      created_at: '2026-08-01T10:00:00Z',
      resolved_at: null,
      message: 'this flow skips the confirm step',
      order_id: '1',
      client_meta: { node_id: '1:2' },
    },
  ]
  const [thread] = toThreads(KEY, raw, 'board')
  assert.ok(thread?.url.includes('/board/'), thread?.url)
})
