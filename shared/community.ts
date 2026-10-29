/**
 * 社区表单规则和 RPC 返回契约；公开社区资料独立于私人 users/pets。
 * 这里只校验格式与长度，敏感词及权限检查必须由数据库完成。
 */
import { z } from 'zod'
export const communityProfileSchema = z
  .string()
  .trim()
  .min(1, '请填写社区昵称')
  .max(32, '社区昵称最多 32 字')
export const postSchema = z
  .string()
  .trim()
  .min(1, '请写下想分享的内容')
  .max(1000, '动态最多 1000 字')
export const commentSchema = z.string().trim().min(1, '请填写评论').max(500, '评论最多 500 字')
export const tagsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, '标签不能为空')
      .max(20, '每个标签最多 20 字')
      .refine((v) => !/[\u0000-\u001f\u007f]/u.test(v), '标签不能包含控制字符'),
  )
  .max(3, '每条动态最多 3 个标签')
  .refine((v) => new Set(v).size === v.length, '标签不能重复')
/**
 * 将中英文逗号分隔的输入转成最多 3 个标签，移除标签开头的 #。
 * 空白分项被丢弃；重复、过长和控制字符由 tagsSchema 拒绝。
 */
export function parseTags(text: string) {
  return tagsSchema.parse(
    text
      .split(/[，,]/u)
      .map((v) => v.trim().replace(/^#+/u, ''))
      .filter(Boolean),
  )
}
export const reportSchema = z
  .string()
  .trim()
  .min(1, '请说明举报原因')
  .max(200, '举报原因最多 200 字')
export type FeedMode = 'recommend' | 'following' | 'favorites' | 'mine'
/**
 * community_feed 的公开动态结果；image_paths 是对象路径，不是永久图片 URL。
 */
export interface CommunityPost {
  id: string
  user_id: string
  nickname: string
  body: string
  pet_label: string | null
  tags: string[]
  image_paths: string[]
  status: 'draft' | 'pending' | 'published' | 'rejected'
  moderation_note: string
  created_at: string
  like_count: number
  comment_count: number
  liked: boolean
  favorited: boolean
}
/**
 * community_person 的社区资料与实时统计，不包含 Auth 邮箱或私有档案。
 */
export interface CommunityPerson {
  user_id: string
  nickname: string
  following_count: number
  follower_count: number
  like_received_count: number
  is_following: boolean
}
/**
 * 评论查询结果；parent_id 只允许指向同帖一级评论，由 RPC 强制校验。
 */
export interface CommunityComment {
  id: string
  post_id: string
  user_id: string
  body: string
  parent_id: string | null
  created_at: string
  author: { nickname: string }
}
/**
 * pending 是历史图片待审状态，当前需作者主动重新提交词库检查，不批量公开。
 */
export const communityStatus = {
  draft: '草稿 · 尚未提交',
  pending: '待重新提交审核',
  published: '已发布',
  rejected: '审核未通过',
}
