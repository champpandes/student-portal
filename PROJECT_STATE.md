# Champ Class Portal — State

## Last updated
2026-10-13

## Status
Multi-teacher upgrade: COMPLETE & WORKING
- Super admin (chmppnds@gmail.com) sees own data
- Regular teachers see only their own data
- Legacy rows migrated to super admin's teacher_id
- All admin actions route through edge function

## Super admin
- Email: chmppnds@gmail.com
- UUID: 86e5eac4-4dd4-44e1-b73d-78659067a9c1

## Regular teacher (test account)
- Email: chmp.edu@gmail.com
- UUID: b5d1239b-a634-4bd0-97a1-0dfd766222b2

## Done
- [x] Edge function `admin` deployed with teacher-scoped reads
- [x] `api.js` callAdmin auto-attaches sessionToken + pin
- [x] `getSubjects` routed through edge function (teacher-scoped)
- [x] `scopeByTeacher` helper: strict `.eq("teacher_id", X)` filter
- [x] `subject_categories.teacher_id` column added + migrated
- [x] All legacy rows migrated to super admin
- [x] Teachers tab: super admin can approve/reject/manage teachers
- [x] PWA install banner positioned bottom-right
- [x] Profile page (display name + change password + account stats)
- [x] "Admin Panel" → "Teacher Panel" text
- [x] sw.js syntax fix (STATIC_ASSETS list was malformed)
- [x] Sections tab refetches on open (was stale sessionStorage cache)
- [x] getMyStats uses student_number (not id) for students count

## Deploy commands
- Frontend:  `git add . && git commit -m "..." && git push`
- Edge fn:   `supabase functions deploy admin --project-ref frrxbthgjawmptlgfjco`

## Gotchas
- `git add` fails ALL-OR-NOTHING on bad paths — check output
- `sw.js` is at repo root, NOT in `js/`
- After JS change: bump CACHE_VERSION in sw.js, then Ctrl+Shift+R
- `git push` and `supabase functions deploy` are SEPARATE
- Tailwind `tailwind.css` is precompiled — arbitrary classes like `z-[150]`, `bottom-20` silently no-op. Add overrides to styles.css
- Server-side and client-side changes must both deploy, or you get "Unknown action" or stale behavior
- sessionStorage caches subjects/sections for 5 min — clear on debug
- `students` uses student_number as PK — no `id` column
- `sw.js` STATIC_ASSETS is a plain array — a missing `];` or comma breaks the whole worker silently
- Sections dropdowns cache in sessionStorage for 5 min — refetch on tab open

## New teacher onboarding flow
1. Teacher registers at login → Teacher tab → "Register as a teacher"
2. Row appears as `pending` in super admin's Teachers tab
3. Super admin approves → teacher can log in
4. Teacher sees their own empty workspace (no cross-teacher data)