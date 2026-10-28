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
export const reportSchema = z
  .string()
  .trim()
  .min(1, '请说明举报原因')
  .max(200, '举报原因最多 200 字')
export type FeedMode = 'recommend' | 'following' | 'favorites' | 'mine'
export interface CommunityPost {
  id: string
  user_id: string
  nickname: string
  body: string
  pet_label: string | null
  image_paths: string[]
  status: 'draft' | 'pending' | 'published' | 'rejected'
  moderation_note: string
  created_at: string
  like_count: number
  comment_count: number
  liked: boolean
  favorited: boolean
}
export interface CommunityPerson {
  user_id: string
  nickname: string
  following_count: number
  follower_count: number
  is_following: boolean
}
export interface CommunityComment {
  id: string
  post_id: string
  user_id: string
  body: string
  parent_id: string | null
  created_at: string
  author: { nickname: string }
}
export const communityStatus = {
  draft: '草稿 · 尚未提交',
  pending: '图片待人工审核',
  published: '已发布',
  rejected: '审核未通过',
}
