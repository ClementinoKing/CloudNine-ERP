import { supabase } from '@/lib/supabase'

export type FolderShareMember = {
  id: string
  fullName: string | null
  username: string | null
  email: string | null
  avatarUrl: string | null
}

export type DriveFolderMemberRow = {
  organizationId: string
  folderId: string
  memberId: string
  grantedBy: string | null
  createdAt: string
  updatedAt: string
}

export async function replaceDriveFolderMembers(folderId: string, memberIds: string[]) {
  return supabase.rpc('replace_drive_folder_members', {
    p_folder_id: folderId,
    p_member_ids: memberIds,
  })
}
