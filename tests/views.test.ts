// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import RecordView from '../src/views/RecordView.vue'
import PetEditView from '../src/views/PetEditView.vue'
import AIView from '../src/views/AIView.vue'
import type { Component } from 'vue'
const mocks = vi.hoisted(() => ({
  getPets: vi.fn(),
  getPet: vi.fn(),
  savePet: vi.fn(),
  addRecord: vi.fn(),
  attachRecordImages: vi.fn(),
  uploadAvatar: vi.fn(),
  validateImage: vi.fn(),
  history: vi.fn(),
  usage: vi.fn(),
  askAI: vi.fn(),
}))
vi.mock('../src/lib/api', () => mocks)
vi.mock('../src/lib/supabase', () => ({ configured: true }))
const pet = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '团子',
  species: 'cat',
  breed: '',
  gender: 'unknown',
  date_kind: 'birth',
  birth_date: null,
  weight: 4,
  sterilized: false,
  remark: '',
}
const mounted: ReturnType<typeof mount>[] = []
async function render(component: Component, path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component, { global: { plugins: [router] } })
  mounted.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.getPets.mockResolvedValue([pet])
  mocks.getPet.mockResolvedValue(pet)
  mocks.savePet.mockResolvedValue(pet)
  mocks.addRecord.mockResolvedValue({
    id: 'record-a',
    pet_id: pet.id,
    type: 'feeding',
    content: {},
    occurred_at: new Date().toISOString(),
  })
  mocks.attachRecordImages.mockResolvedValue(undefined)
  mocks.history.mockResolvedValue({ messages: [], requests: [] })
  mocks.usage.mockResolvedValue(0)
  mocks.askAI.mockResolvedValue({ answer: 'ok' })
})
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount())
  vi.useRealTimers()
})
describe('actual Vue forms with mocked API boundary', () => {
  it('keeps the same record UUID when retrying a lost response', async () => {
    mocks.addRecord.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { wrapper } = await render(RecordView, '/records/new?type=weight')
    await wrapper.get('input[type="number"]').setValue('4.1')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(mocks.addRecord).toHaveBeenCalledTimes(2)
    expect(mocks.addRecord.mock.calls[0]![4]).toBe(mocks.addRecord.mock.calls[1]![4])
  })
  it('creates feeding record with selected pet and actual form values', async () => {
    const { wrapper, router } = await render(RecordView, `/records/new?pet=${pet.id}`)
    await wrapper.get('input[maxlength="100"]').setValue('成猫粮')
    await wrapper.get('input[type="number"]').setValue('45')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(mocks.addRecord).toHaveBeenCalledWith(
      pet.id,
      'feeding',
      { food: '成猫粮', amount: 45, unit: 'g' },
      expect.any(String),
      expect.any(String),
    )
    expect(router.currentRoute.value.path).toBe(`/pets/${pet.id}`)
  })
  it('does not write invalid weight and offers no successful navigation', async () => {
    const { wrapper, router } = await render(RecordView, '/records/new?type=weight')
    await wrapper.get('input[type="number"]').setValue('-1')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(mocks.addRecord).not.toHaveBeenCalled()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(router.currentRoute.value.path).toBe('/records/new')
  })
  it('shows a create-pet entry when the account has no pets', async () => {
    mocks.getPets.mockResolvedValue([])
    const { wrapper } = await render(RecordView, '/records/new')
    expect(wrapper.text()).toContain('先给它创建一份档案')
    expect(wrapper.find('form').exists()).toBe(false)
  })
  it('creates pet with validated fields and never invokes avatar upload without a file', async () => {
    const { wrapper, router } = await render(PetEditView, '/pets/new')
    await wrapper.get('input[maxlength="32"]').setValue(' 饭团 ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(mocks.savePet).toHaveBeenCalledOnce()
    expect(mocks.uploadAvatar).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe(`/pets/${pet.id}`)
  })
  it('AI sends the selected pet and disables duplicate submission during processing', async () => {
    let resolve!: (value: { answer: string }) => void
    mocks.askAI.mockImplementation(
      () =>
        new Promise<{ answer: string }>((r) => {
          resolve = r
        }),
    )
    const { wrapper } = await render(AIView, `/ai?pet=${pet.id}`)
    await wrapper.get('textarea').setValue('结合它最近记录给我建议')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    expect(mocks.askAI).toHaveBeenCalledOnce()
    expect(mocks.askAI.mock.calls[0]![0]).toMatchObject({
      pet_id: pet.id,
      question: '结合它最近记录给我建议',
    })
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.message.user .message-bubble').text()).toBe('结合它最近记录给我建议')
    expect(wrapper.get('[role="status"]').text()).toContain('正在思考')
    expect(wrapper.find('.chat-empty').exists()).toBe(false)
    resolve({ answer: '请继续记录食欲和精神状态。' })
    await flushPromises()
    expect(wrapper.get('.message.assistant .message-bubble').text()).toBe(
      '请继续记录食欲和精神状态。',
    )
    expect(wrapper.find('.thinking-message').exists()).toBe(false)
  })
  it('shows the returned answer before a delayed history read completes', async () => {
    const { wrapper } = await render(AIView, `/ai?pet=${pet.id}`)
    let finishHistory!: (value: { messages: []; requests: [] }) => void
    mocks.history.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishHistory = resolve
        }),
    )
    mocks.askAI.mockResolvedValueOnce({ answer: '已结合体重记录整理回答。', used: 3 })
    await wrapper.get('textarea').setValue('体重记录说明什么？')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('.message.assistant .message-bubble').text()).toBe(
      '已结合体重记录整理回答。',
    )
    expect(wrapper.text()).toContain('今日已用 3 / 20 次')
    expect(wrapper.find('.thinking-message').exists()).toBe(false)
    finishHistory({ messages: [], requests: [] })
    await flushPromises()
    expect(wrapper.findAll('.message.assistant')).toHaveLength(1)
  })
  it('keeps a successful answer visible if background history fails', async () => {
    const { wrapper } = await render(AIView, `/ai?pet=${pet.id}`)
    mocks.history.mockRejectedValueOnce(new Error('Failed to fetch'))
    mocks.askAI.mockResolvedValueOnce({ answer: '已经保存的回答仍应显示。' })
    await wrapper.get('textarea').setValue('给我日常记录建议')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('.message.assistant .message-bubble').text()).toBe(
      '已经保存的回答仍应显示。',
    )
    await wrapper.get('textarea').setValue('继续咨询')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).not.toContain('检查 / 重试同一请求')
  })
  it('reconciles saved message IDs without duplicating the displayed question or answer', async () => {
    const { wrapper } = await render(AIView, `/ai?pet=${pet.id}`)
    mocks.askAI.mockImplementationOnce(async (body) => {
      mocks.history.mockResolvedValue({
        messages: ['user', 'assistant'].map((role) => ({
          id: `saved-${role}`,
          request_id: body.request_id,
          session_id: body.session_id,
          pet_id: pet.id,
          role,
          content: role === 'user' ? body.question : '数据库已保存的回答',
          created_at: new Date().toISOString(),
        })),
        requests: [
          {
            id: body.request_id,
            session_id: body.session_id,
            question: body.question,
            status: 'succeeded',
            error_code: null,
            created_at: new Date().toISOString(),
          },
        ],
      })
      return { answer: '数据库已保存的回答' }
    })
    await wrapper.get('textarea').setValue('同一问题不应重复显示')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.findAll('.message.user')).toHaveLength(1)
    expect(wrapper.findAll('.message.assistant')).toHaveLength(1)
    expect(wrapper.findAll('.session-item')).toHaveLength(1)
  })
  it('AI failure exposes a same-ID retry and the retry reuses the original ID', async () => {
    mocks.askAI.mockRejectedValueOnce(new Error('UPSTREAM_TIMEOUT'))
    const { wrapper } = await render(AIView, `/ai?pet=${pet.id}`)
    await wrapper.get('textarea').setValue('它今天精神如何？')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('AI 响应超时')
    const first = mocks.askAI.mock.calls[0]![0]
    const retry = wrapper.findAll('button').find((b) => b.text().includes('检查 / 重试'))!
    await retry.trigger('click')
    await flushPromises()
    expect(mocks.askAI.mock.calls[1]![0]).toEqual(first)
  })
  it('automatically retrieves a pending answer and stops checking when unmounted', async () => {
    vi.useFakeTimers()
    const { wrapper } = await render(AIView, `/ai?pet=${pet.id}`)
    mocks.askAI.mockImplementationOnce(async (body) => {
      const request = {
        id: body.request_id,
        session_id: body.session_id,
        question: body.question,
        error_code: null,
        created_at: new Date().toISOString(),
      }
      mocks.history
        .mockResolvedValueOnce({ messages: [], requests: [{ ...request, status: 'pending' }] })
        .mockResolvedValue({
          messages: [
            {
              id: 'saved-answer',
              request_id: body.request_id,
              session_id: body.session_id,
              pet_id: pet.id,
              role: 'assistant',
              content: '后台完成后自动出现的回答',
              created_at: request.created_at,
            },
          ],
          requests: [{ ...request, status: 'succeeded' }],
        })
      throw new Error('REQUEST_PENDING')
    })
    await wrapper.get('textarea').setValue('正在处理的请求')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('.thinking-message').text()).toContain('正在思考')
    await vi.advanceTimersByTimeAsync(2100)
    await flushPromises()
    expect(wrapper.get('.message.assistant .message-bubble').text()).toBe(
      '后台完成后自动出现的回答',
    )
    expect(wrapper.find('.thinking-message').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('检查 / 重试同一请求')
    mocks.askAI.mockRejectedValueOnce(new Error('REQUEST_PENDING'))
    mocks.history.mockResolvedValue({ messages: [], requests: [] })
    await wrapper.get('textarea').setValue('离开页面时仍在处理的请求')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('.thinking-message').exists()).toBe(true)
    wrapper.unmount()
    const calls = mocks.history.mock.calls.length
    await vi.advanceTimersByTimeAsync(10000)
    expect(mocks.history).toHaveBeenCalledTimes(calls)
  })
  it('renders saved AI output as text rather than executing HTML', async () => {
    mocks.history.mockResolvedValue({
      messages: [
        {
          id: 'm',
          session_id: 'existing',
          pet_id: pet.id,
          role: 'assistant',
          content: '<img src=x onerror=alert(1)>',
          created_at: new Date().toISOString(),
        },
      ],
      requests: [
        {
          id: 'r',
          session_id: 'existing',
          question: '历史问题',
          status: 'succeeded',
          created_at: new Date().toISOString(),
        },
      ],
    })
    const { wrapper } = await render(AIView, `/ai?pet=${pet.id}`)
    const historyButton = wrapper.findAll('button').find((b) => b.text().includes('历史问题'))!
    await historyButton.trigger('click')
    await flushPromises()
    expect(wrapper.get('.message-bubble').text()).toContain('<img')
    expect(wrapper.find('.message-bubble img').exists()).toBe(false)
  })
})
