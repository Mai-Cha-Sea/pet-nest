import { beforeEach, describe, it, expect, vi } from 'vitest'
const state = vi.hoisted(() => ({
  responses: [] as { data: unknown; error: unknown }[],
  rows: {} as Record<string, unknown[]>,
  insertions: [] as unknown[],
  filters: [] as { table: string; column: string; value: unknown }[],
  uploaded: [] as string[],
  removed: [] as string[],
  reads: [] as { table: string; from: number; until?: string }[],
}))
vi.mock('../src/stores/auth', () => ({
  userId: () => '11111111-1111-4111-8111-111111111111',
  session: { value: null },
}))
vi.mock('../src/lib/supabase', () => ({
  client: () => ({
    functions: { invoke: async () => ({ data: {}, error: null }) },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          state.uploaded.push(path)
          return { error: null }
        },
        remove: async (paths: string[]) => {
          state.removed.push(...paths)
          return { error: null }
        },
      }),
    },
    from: (table: string) => {
      let until: string | undefined
      const builder = {
        select: () => builder,
        insert: (payload: unknown) => {
          state.insertions.push(payload)
          return builder
        },
        update: () => builder,
        eq: (column: string, value: unknown) => {
          state.filters.push({ table, column, value })
          return builder
        },
        gte: () => builder,
        lte: (_column: string, value: string) => {
          until = value
          return builder
        },
        order: () => builder,
        single: async () => state.responses.shift()!,
        maybeSingle: async () => state.responses.shift()!,
        then: (resolve: (value: { data: unknown; error: unknown }) => void) =>
          resolve(state.responses.shift()!),
        range: async (from: number, to: number) => {
          state.reads.push({ table, from, until })
          return {
            data: (state.rows[table] || []).slice(from, to + 1),
            error: null,
          }
        },
      }
      return builder
    },
  }),
}))
import { savePet, addRecord, history, validateImage, uploadAvatar } from '../src/lib/api'
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const input = {
  name: '团子',
  species: 'cat' as const,
  breed: '',
  gender: 'unknown' as const,
  date_kind: 'birth' as const,
  birth_date: '',
  weight: null,
  sterilized: false,
  remark: '',
}
beforeEach(() => {
  state.responses = []
  state.rows = {}
  state.insertions = []
  state.filters = []
  state.uploaded = []
  state.removed = []
  state.reads = []
})
describe('API boundary regression tests (Supabase transport is mocked)', () => {
  const image = () =>
    new File([new Uint8Array([255, 216, 255])], 'avatar.jpg', { type: 'image/jpeg' })
  it('does not delete an avatar when its linking update succeeded but the response was lost', async () => {
    state.responses = [
      { data: null, error: { message: 'Failed to fetch' } },
      {
        data: {
          get avatar_path() {
            return state.uploaded[0]
          },
        },
        error: null,
      },
    ]
    expect(await uploadAvatar(image(), id)).toBe(state.uploaded[0])
    expect(state.removed).toHaveLength(0)
  })
  it('removes an unused upload only after confirming that the DB does not reference it', async () => {
    state.responses = [
      { data: null, error: { message: 'link failed' } },
      { data: { avatar_path: null }, error: null },
    ]
    await expect(uploadAvatar(image(), id)).rejects.toMatchObject({ message: 'link failed' })
    expect(state.removed).toEqual(state.uploaded)
  })
  it('retains the upload when a second network failure leaves the link state unknown', async () => {
    state.responses = [
      { data: null, error: { message: 'network lost' } },
      { data: null, error: { message: 'network still lost' } },
    ]
    await expect(uploadAvatar(image(), id)).rejects.toMatchObject({ message: 'network lost' })
    expect(state.removed).toHaveLength(0)
  })
  it('recovers a same-ID pet retry after the first response was lost', async () => {
    state.responses = [
      { data: null, error: { code: '23505' } },
      { data: { ...input, id, birth_date: null }, error: null },
    ]
    expect((await savePet(input, undefined, id)).id).toBe(id)
    expect(state.insertions[0]).toMatchObject({ id, name: '团子' })
  })
  it('does not silently overwrite a changed payload under the same pet ID', async () => {
    state.responses = [
      { data: null, error: { code: '23505' } },
      { data: { ...input, id, name: '旧名字', birth_date: null }, error: null },
    ]
    await expect(savePet(input, undefined, id)).rejects.toThrow('内容与本次不同')
  })
  it('reuses the saved record after an ambiguous network result', async () => {
    state.responses = [
      { data: null, error: { code: '23505' } },
      {
        data: {
          id,
          pet_id: id,
          type: 'weight',
          content: { weight: 4.1 },
          occurred_at: '2026-10-01T00:00:00+00:00',
        },
        error: null,
      },
    ]
    expect(
      (await addRecord(id, 'weight', { weight: 4.1 }, '2026-10-01T00:00:00.000Z', id)).id,
    ).toBe(id)
  })
  it('loads all 1,200 messages in the 30-day window instead of truncating at 1,000', async () => {
    const serverNow = Date.now() + 60000
    state.rows.ai_conversations = Array.from({ length: 1200 }, (_, i) => ({
      id: String(i),
      content: `message-${i}`,
      created_at: new Date(serverNow - i * 1000).toISOString(),
    }))
    state.rows.ai_requests = Array.from({ length: 600 }, (_, i) => ({
      id: String(i),
      created_at: new Date(serverNow - i * 1000).toISOString(),
    }))
    const result = await history(id)
    expect(result.messages).toHaveLength(1200)
    expect(result.requests).toHaveLength(600)
    expect(result.messages[0]!.content).toBe('message-1199')
    expect(state.filters.every((f) => f.column === 'pet_id' && f.value === id)).toBe(true)
    expect(state.reads.filter((r) => r.from === 0).every((r) => r.until === undefined)).toBe(true)
    expect(
      state.reads
        .filter((r) => r.from > 0)
        .every((r) => r.until === new Date(serverNow).toISOString()),
    ).toBe(true)
  })
  it('checks image MIME, size and file signature', async () => {
    await expect(
      validateImage(new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })),
    ).rejects.toThrow('仅支持')
    await expect(
      validateImage(new File(['not a png'], 'x.png', { type: 'image/png' })),
    ).rejects.toThrow('内容与图片类型不符')
    await expect(
      validateImage(
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'x.jpg', { type: 'image/jpeg' }),
      ),
    ).rejects.toThrow('不超过')
    await expect(
      validateImage(
        new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'x.png', {
          type: 'image/png',
        }),
      ),
    ).resolves.toBe('png')
  })
})
