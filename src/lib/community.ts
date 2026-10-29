/**
 * P1 社区的数据访问层，与私有档案使用不同表和存储 bucket。
 * 浏览器负责字段预检，RPC 从 JWT 获取身份并检查词库、频率和归属。
 * RPC 返回值采用共享类型声明；更改 SQL 返回字段时同步 shared/community.ts 与测试。
 */
import { z } from 'zod'
import { client } from './supabase'
import { userId } from '../stores/auth'
import { validateImage, cleanup } from './api'
import {
  communityProfileSchema,
  postSchema,
  commentSchema,
  reportSchema,
  tagsSchema,
} from '../../shared/community'
import type {
  CommunityPost,
  CommunityPerson,
  CommunityComment,
  FeedMode,
} from '../../shared/community'
/**
 * 统一检查 RPC 的 error 后返回声明的结果类型；T 是编译期断言，并不验证 JSON。
 */
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().rpc(name, args)
  if (error) throw error
  return data as T
}
/**
 * 读取社区公开资料及统计；未开通者返回 null，私有账号资料不在结果中。
 */
export const getCommunityPerson = (id: string) =>
  rpc<CommunityPerson | null>('community_person', { p_user: z.uuid().parse(id) })
/**
 * 显式开通/修改公开社区昵称，服务端检查词库；不会改私人资料昵称。
 */
export const saveCommunityProfile = (nickname: string) =>
  rpc<void>('community_set_profile', { p_nickname: communityProfileSchema.parse(nickname) })
/**
 * 读取 20 条社区信息流；offset 按服务端行数递增，author/post 用于作者页或单帖。
 */
export const getFeed = (mode: FeedMode, offset = 0, author?: string, post?: string) =>
  rpc<CommunityPost[]>('community_feed', {
    p_mode: mode,
    p_offset: offset,
    p_author: author ? z.uuid().parse(author) : null,
    p_post: post ? z.uuid().parse(post) : null,
  })
/**
 * 通过相同的 RLS 受控信息流读取单帖，空结果统一抛 POST_NOT_FOUND。
 */
export async function getCommunityPost(id: string) {
  const rows = await getFeed('recommend', 0, undefined, id)
  if (!rows[0]) throw new Error('POST_NOT_FOUND')
  return rows[0]
}
/**
 * 创建草稿；id 由发布页固定并复用于重试，内容改变而 ID 不变会触发冲突。
 * pet 仅允许本人宠物，服务端复制名称，不公开原档案。
 */
export const createCommunityPost = (id: string, body: string, pet?: string, tags: string[] = []) =>
  rpc<string>('community_create_post', {
    p_id: z.uuid().parse(id),
    p_body: postSchema.parse(body),
    p_pet: pet ? z.uuid().parse(pet) : null,
    p_tags: tagsSchema.parse(tags),
  })
/**
 * 将已检查的图片放入本人/动态 UUID 目录，返回待发布关联的对象路径。
 */
export async function uploadCommunityImage(file: File, post: string) {
  const ext = await validateImage(file)
  const path = `${userId()}/posts/${z.uuid().parse(post)}/${crypto.randomUUID()}.${ext}`
  const { error } = await client()
    .storage.from('community-media')
    .upload(path, file, { upsert: false, contentType: file.type })
  if (error) throw error
  return path
}
/**
 * 关联最多 9 张已存在对象并申请词库检查后发布；重复同路径提交保持幂等。
 * 最终状态及旧 pending/rejected 的转换规则由数据库 RPC 决定。
 */
export const publishCommunityPost = (id: string, images: string[]) =>
  rpc<CommunityPost['status']>('community_publish', {
    p_post: z.uuid().parse(id),
    p_images: z.array(z.string()).max(9).parse(images),
  })
/**
 * 删除本人动态并触发图片队列清理；评论与互动由数据库级联处理。
 */
export async function deleteCommunityPost(id: string) {
  await rpc('community_delete_post', { p_post: z.uuid().parse(id) })
  await cleanup()
}
/**
 * 设置点赞/收藏/关注的目标 enabled 状态，重复网络请求不反转或重复计数。
 */
export const setCommunityInteraction = (
  target: string,
  kind: 'like' | 'favorite' | 'follow',
  enabled: boolean,
) =>
  rpc<void>('community_interact', {
    p_target: z.uuid().parse(target),
    p_kind: kind,
    p_enabled: enabled,
  })
/**
 * 按创建时间/ID 倒序读取 50 条可见评论，包含公开社区昵称；offset 为行偏移。
 */
export async function getComments(post: string, offset = 0) {
  const { data, error } = await client()
    .from('community_comments')
    .select('id,post_id,user_id,body,parent_id,created_at,author:community_profiles(nickname)')
    .eq('post_id', z.uuid().parse(post))
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + 49)
  if (error) throw error
  return data as unknown as CommunityComment[]
}
/**
 * 使用固定 UUID 创建评论或一级回复；重试必须保留 UUID 和原正文/父评论。
 */
export const addComment = (id: string, post: string, body: string, parent?: string) =>
  rpc<string>('community_add_comment', {
    p_id: z.uuid().parse(id),
    p_post: z.uuid().parse(post),
    p_body: commentSchema.parse(body),
    p_parent: parent ? z.uuid().parse(parent) : null,
  })
/**
 * 删除本人评论；删除一级评论会级联删除回复，调用页面需先向用户确认。
 */
export const deleteComment = (id: string) =>
  rpc<void>('community_delete_comment', { p_comment: z.uuid().parse(id) })
/**
 * 提交私有举报，目标必须是动态或评论之一；去重与归属由 RPC 执行。
 */
export const reportContent = (
  id: string,
  reason: string,
  target: { post?: string; comment?: string },
) =>
  rpc<void>('community_report', {
    p_id: z.uuid().parse(id),
    p_reason: reportSchema.parse(reason),
    p_post: target.post ? z.uuid().parse(target.post) : null,
    p_comment: target.comment ? z.uuid().parse(target.comment) : null,
  })
/**
 * 读取某社区用户的关注/粉丝公开昵称列表，每页 20；不返回私人账号资料。
 */
export const getCommunityPeople = (user: string, list: 'followers' | 'following', offset = 0) =>
  rpc<Pick<CommunityPerson, 'user_id' | 'nickname'>[]>('community_people', {
    p_user: z.uuid().parse(user),
    p_list: list,
    p_offset: offset,
  })
