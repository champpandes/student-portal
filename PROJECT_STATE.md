# Champ Class Portal — State

## Last updated
2026-10-13

## Status
Multi-teacher upgrade: DEPLOYED & WORKING (with minor fixes remaining)

## Done
- [x] Edge function `admin` deployed with teacher-scoped reads
- [x] `api.js` — `callAdmin` auto-attaches `sessionToken` and `pin`
- [x] `teachers.js` — super admin teacher management tab
- [x] Super admin registered (UUID: 3d3faad8-aef1-43fd-9176-65e50bda850f)
- [x] Legacy data bridge: `scopeByTeacher` uses `.or("teacher_id.eq.X,teacher_id.is.null")`
- [x] All legacy rows migrated to super admin's teacher_id
- [x] Class Record categories visible (subject_categories.teacher_id added)

## Remaining / known issues
- [ ] PWA install banner peeking at top-left (`ne scr` fragment) — CSS fix in progress
- [ ] PWA banner CSS: add `#pwa-install-banner { top: auto; bottom: 5rem; }` to styles.css

## Deploy commands
- Frontend:  `git add . && git commit -m "..." && git push`
- Edge fn:   `supabase functions deploy admin --project-ref frrxbthgjawmptlgfjco`

## Gotchas (learned the hard way)
- `git add` fails ALL-OR-NOTHING on bad paths — check output carefully
- `sw.js` is at repo root, NOT in `js/`
- After any JS change: bump CACHE_VERSION in sw.js, then Ctrl+Shift+R
- After JS changes, may need: DevTools → Application → Unregister SW → Clear site data
- `git push` and `supabase functions deploy` are SEPARATE actions — neither affects the other
- Legacy rows have `teacher_id = NULL` — that's why `scopeByTeacher` uses `.is.null`
- Tailwind `tailwind.css` is compiled — missing utility classes silently do nothing

## File map
- `index.html`               — SPA shell, all screens & modals
- `js/config.js`             — Supabase URL/key, App.state
- `js/utils.js`              — esc, debounce, toasts, modals, sessions
- `js/api.js`                — all backend calls (callAdmin + apiCall)
- `js/auth.js`               — login, register, session restore
- `js/main.js`               — boot, event wiring
- `js/admin.js`              — dashboard, table, panel, filters
- `js/teachers.js`           — super admin teacher management
- `js/student.js`            — student dashboard, breakdown
- `js/subjects.js`           — subjects & weights
- `js/sections.js`           — sections
- `js/class-record.js`       — class record & assessments
- `js/grading-sheet.js`      — printable grading sheets
- `js/analytics.js`          — analytics tab
- `js/registrations.js`      — student registration approval
- `js/comments.js`           — announcements & comments
- `js/import.js`             — CSV/Excel import & export
- `js/backup.js`             — full backup & restore
- `js/grades.js`             — grading helpers
- `sw.js`                    — service worker (at repo root)
- `supabase/functions/admin/index.ts` — edge function