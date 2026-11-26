import { createFileRoute } from '@tanstack/react-router'
import { ProfilePage } from '../../features/profile/profile-page'

// Any signed-in user: the page needs no permission of its own
export const Route = createFileRoute('/_app/profile')({
  component: ProfilePage,
})
