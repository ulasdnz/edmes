# Test Scenarios: profile

> Generated: 2026-11-26 | Spec: docs/superpowers/specs/2026-11-25-dual-frontend-architecture-design.md (sections 7, 12: B9) | Design: "Edmes Web App" canvas boards Profile, Topbar
> Status: READY
> Immutable after implementation starts.
>    To change: update this file, then re-run /write-scenario-tests.

Scope: the web app's Profile page as the canvas draws it, the "Profile and language" item of the user menu, and the backend it needs. Owner decisions of 2026-11-26: the design is the authority; gender has two values, female and male ("Other" and "Prefer not to say" are removed); only an administrator changes a username.

---

## UserGender.twoValues
> target: user/src/modules/user/user.validators.test.ts

### constraints
- [HIGH] `updateMeSchema` and `adminUpdateUserSchema` accept `gender: 'female'` and `gender: 'male'` and reject `gender: 'other'`
- the user model's `gender` enum is exactly `['male', 'female']`; saving a user with `gender: 'other'` fails validation

---

## UserMe.usernameAdminOnly
> target: user/src/modules/user/__tests__/user.routes.test.ts

### authorization
- [CRITICAL] `PATCH /api/v1/users/me` with `username` → 400 with the validation envelope, and the stored username is unchanged
- `PATCH /api/v1/users/:id` with `username` by a caller holding `writeUsers` → 200 and the username changes (an administrator still can)

---

## UserMe.avatarRemove
> target: user/src/modules/user/__tests__/user.avatar.test.ts

### happy path
- a user with an uploaded avatar, `DELETE /api/v1/users/me/avatar` → 200 `{ data, message }`, `data.avatar` is null, `GET /users/me` shows no avatar and the file is gone from the uploads volume

### boundaries
- a user with no avatar, `DELETE /api/v1/users/me/avatar` → 200, `data.avatar` null (nothing to remove is not an error)

### authorization
- [CRITICAL] without a token → 401; the call only ever removes the caller's own avatar

---

## UserMe.roles
> target: user/src/modules/user/__tests__/user.routes.test.ts

### happy path
- `GET /api/v1/users/me?populate=roles` → `data.roles` is a list of `{ _id, name, description }` for the caller's roles, without `permissions`, and with no `readRoles` permission needed

### boundaries
- `GET /api/v1/users/me` without `populate` → `data.roles` stays a list of ids (the session store relies on it)
- a caller with no roles → `data.roles` is `[]`

---

## OpenApiDocument.profile
> target: user/src/lib/openapi/document.test.ts

### constraints
- the document has `DELETE /users/me/avatar`, the `populate` query of `GET /users/me`, `gender` as `female | male`, and no `username` in the body of `PATCH /users/me`

---

## Web.userMenuProfile
> target: apps/web/src/components/topbar.browser.test.tsx

### happy path
- the user menu shows the user's name and role line, then "Profile and language" (Turkish "Profil ve dil") linking to `/profile`, then "Log out"

---

## Web.profilePage
> target: apps/web/src/features/profile/profile-page.browser.test.tsx

### happy path
- `/profile` shows the heading "Profile", the line "Your own account · signed in as <username> since HH:mm" (HH:mm the plant time of the token's issue time), and a "Log out" button
- the Personal details card shows Name and Surname (required), Username read-only with a lock and "Only an administrator can change your username.", Email (required), Language (English, Türkçe) with its hint, Gender (Female, Male, and empty when not set), Birth date
- "Save profile" sends only the changed fields with `PATCH /users/me`; on success the form shows the saved values and a success toast
- saving another language switches the app's language at once
- the Your roles card lists each role's name and description and says "Read only"; the Your work centers card lists the codes of the user's work centers and how many are physical and virtual

### boundaries
- no avatar → the initials are shown, "Remove" is disabled; with an avatar, "Remove" sends `DELETE /users/me/avatar` and the initials come back
- Gender offers exactly Female and Male

### edge cases
- the server answers 400 with `details` → "Your profile was not saved." banner and each message under its field (the email's "Enter a complete email address, for example name@company.com." comes from the server or the client's own check)
- "Discard changes" puts back the stored values and enables Save only after a change
- an upload that is not PNG or JPG, or over 2 MB → the server's message under the avatar, the current avatar stays
- the Profile page needs no permission beyond being signed in

---

## E2E.profile
> target: apps/ui-e2e/src/web-profile.spec.ts

### happy path
- a seeded user opens Profile and language from the user menu, changes the surname and the language to Türkçe, saves: the menu shows the new name, the app is in Turkish, a reload keeps both
- the user uploads a PNG avatar, sees it on the Profile page, removes it, sees the initials again

### authorization
- [CRITICAL] the username field cannot be changed from Profile, and the API refuses a username sent by the user
