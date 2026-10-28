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
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().rpc(name, args)
  if (error) throw error
  return data as T
}
export const getCommunityPerson = (id: string) =>
  rpc<CommunityPerson | null>('community_person', { p_user: z.uuid().parse(id) })
export const saveCommunityProfile = (nickname: string) =>
  rpc<void>('community_set_profile', { p_nickname: communityProfileSchema.parse(nickname) })
export const getFeed = (mode: FeedMode, offset = 0, author?: string, post?: string) =>
  rpc<CommunityPost[]>('community_feed', {
    p_mode: mode,
    p_offset: offset,
    p_author: author ? z.uuid().parse(author) : null,
    p_post: post ? z.uuid().parse(post) : null,
  })
export async function getCommunityPost(id: string) {
  const rows = await getFeed('recommend', 0, undefined, id)
  if (!rows[0]) throw new Error('POST_NOT_FOUND')
  return rows[0]
}
export const createCommunityPost = (id: string, body: string, pet?: string, tags: string[] = []) =>
  rpc<string>('community_create_post', {
    p_id: z.uuid().parse(id),
    p_body: postSchema.parse(body),
    p_pet: pet ? z.uuid().parse(pet) : null,
    p_tags: tagsSchema.parse(tags),
  })
export async function uploadCommunityImage(file: File, post: string) {
  const ext = await validateImage(file)
  const path = `${userId()}/posts/${z.uuid().parse(post)}/${crypto.randomUUID()}.${ext}`
  const { error } = await client()
    .storage.from('community-media')
    .upload(path, file, { upsert: false, contentType: file.type })
  if (error) throw error
  return path
}
export const publishCommunityPost = (id: string, images: string[]) =>
  rpc<CommunityPost['status']>('community_publish', {
    p_post: z.uuid().parse(id),
    p_images: z.array(z.string()).max(9).parse(images),
  })
export async function deleteCommunityPost(id: string) {
  await rpc('community_delete_post', { p_post: z.uuid().parse(id) })
  await cleanup()
}
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
export const addComment = (id: string, post: string, body: string, parent?: string) =>
  rpc<string>('community_add_comment', {
    p_id: z.uuid().parse(id),
    p_post: z.uuid().parse(post),
    p_body: commentSchema.parse(body),
    p_parent: parent ? z.uuid().parse(parent) : null,
  })
export const deleteComment = (id: string) =>
  rpc<void>('community_delete_comment', { p_comment: z.uuid().parse(id) })
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
export const getCommunityPeople = (user: string, list: 'followers' | 'following', offset = 0) =>
  rpc<Pick<CommunityPerson, 'user_id' | 'nickname'>[]>('community_people', {
    p_user: z.uuid().parse(user),
    p_list: list,
    p_offset: offset,
  })
