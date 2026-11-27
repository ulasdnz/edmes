import { type ApiClient, ApiError, type paths } from '@mes/api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'

type MeResponse = paths['/users/me']['get']['responses'][200]['content']['application/json']

export type Me = MeResponse['data']
export type MyRole = Exclude<Me['roles'][number], string>
export type UpdateMeBody = NonNullable<
  paths['/users/me']['patch']['requestBody']
>['content']['application/json']
export type SavedMe =
  paths['/users/me']['patch']['responses'][200]['content']['application/json']['data']

export interface MyProfile {
  user: Me
  roles: MyRole[]
}

// The signed-in user with role names, for the top bar's role line and the Profile page. Keyed
// under get /users/me, so a saved change invalidates it with every other read of /users/me.
export function myProfileOptions(api: ApiClient) {
  return api.$api.queryOptions(
    'get',
    '/users/me',
    { params: { query: { populate: 'roles' } } },
    {
      select: (response: MeResponse): MyProfile => ({
        user: response.data,
        roles: response.data.roles.filter((role): role is MyRole => typeof role !== 'string'),
      }),
    },
  )
}

function bodyOf<T>(data: { data: T } | undefined): T {
  if (!data) throw new ApiError({ kind: 'http', status: 200, code: 'client.unexpected_response' })
  return data.data
}

export async function updateMe(api: ApiClient, body: UpdateMeBody): Promise<SavedMe> {
  const { data } = await api.fetchClient.PATCH('/users/me', { body })
  return bodyOf(data)
}

export async function uploadMyAvatar(api: ApiClient, file: File): Promise<SavedMe> {
  const { data } = await api.fetchClient.PATCH('/users/me/avatar', {
    body: {},
    bodySerializer: () => {
      const form = new FormData()
      form.append('photo', file)
      return form
    },
  })
  return bodyOf(data)
}

export async function removeMyAvatar(api: ApiClient): Promise<SavedMe> {
  const { data } = await api.fetchClient.DELETE('/users/me/avatar')
  return bodyOf(data)
}

// The saved user replaces the cached profile at once, keeping its role names, and every read of
// /users/me refetches
function useMyProfileMutation<T>(api: ApiClient, mutationFn: (input: T) => Promise<SavedMe>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: saved => {
      queryClient.setQueryData<MeResponse>(myProfileOptions(api).queryKey, previous =>
        previous ? { ...previous, data: { ...saved, roles: previous.data.roles } } : previous,
      )
      return queryClient.invalidateQueries({ queryKey: ['get', '/users/me'] })
    },
  })
}

export function useUpdateMe(api: ApiClient) {
  return useMyProfileMutation(api, (body: UpdateMeBody) => updateMe(api, body))
}

export function useUploadMyAvatar(api: ApiClient) {
  return useMyProfileMutation(api, (file: File) => uploadMyAvatar(api, file))
}

export function useRemoveMyAvatar(api: ApiClient) {
  return useMyProfileMutation(api, () => removeMyAvatar(api))
}
