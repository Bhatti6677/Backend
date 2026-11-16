# 🤖 AI Codebase Context & Fast-Analysis Index (`AI_CONTEXT.md`)

> **Purpose**: Read this file FIRST before scanning the repository. It maps every business rule, file path, database model, and deployment target so you can locate and modify code immediately without exploratory searches.

---

## 1. Repository & Deployment Architecture

The workspace (`/Users/mmaazfalak/antigravity/Project55`) contains **two independent Git repositories** deployed separately on Vercel, plus a legacy root mirror (`src/server` and `src/client`):

| Component | Local Directory | GitHub Remote (`main`) | Build Command | Entry / Output |
| :--- | :--- | :--- | :--- | :--- |
| **Backend API** | `backend/` | `https://github.com/Bhatti6677/Backend.git` | `cd backend && npx tsc --noEmit && npm run build` | Bundles `backend/src/serverless.ts` $\rightarrow$ `backend/api/index.js` |
| **Frontend SPA** | `frontend/` | `https://github.com/Bhatti6677/rewardsheet.git` | `cd frontend && npx tsc --noEmit && npm run build` | Builds `frontend/src/main.tsx` $\rightarrow$ `frontend/dist/` |
| **Root Mirror** | `src/server/` & `src/client/` | *(Workspace mirror)* | `npx tsc --noEmit -p tsconfig.server.json` | Keep synced when editing `backend/src` or `frontend/src` |

> **IMPORTANT SYNC RULE**: Whenever you modify a file in `backend/src/...` or `frontend/src/...`, copy it to its counterpart in `src/server/...` or `src/client/src/...`, run `npm run build` in `backend/` (so `backend/api/index.js` is updated), and push both `backend/` and `frontend/` git repos when requested.

---

## 2. Core Business Rules (Current Production Spec)

### A. 10-Level & 100-Task System (No Level Rewards — Task Rewards Only)
- **Zero Level Completion Rewards**: `Level.completionReward = 0` across all 10 levels. Users **only** earn rewards per individual task (`Task.rewardAmount`). Never credit or display a level completion bonus.
- **Level 1**: 10 free tasks (`isPaid = false`, `unlockFee = 0`), each rewarding **PKR 15** (`rewardAmount = 15`). All 10 tasks must be `APPROVED` to unlock Level 2.
- **Level 2**: Tasks 1–9 are free (`rewardAmount = 40`). **Task 10 is prepaid** costing **PKR 1,410** (`isPaid = true`, `unlockFee = 1410`) with a 40% commission of **PKR 564** (`rewardAmount = 564`). All 10 tasks must be `APPROVED` to unlock Level 3.
- **Level 3**: Tasks 1–8 are free (`rewardAmount = 60`). **Task 9 is prepaid** costing **PKR 6,257** with a 40% commission of **PKR 2,503**. **Task 10 is prepaid** costing **PKR 14,260** with a 40% commission of **PKR 5,704**. All 10 tasks must be `APPROVED` to finish Level 3.
- **Level 4 (VIP Prepaid Tier)**: 10 prepaid tasks (`isPaid = true`), each paying **40% commission**:
  - Task 1: Fee `30,000` $\rightarrow$ Reward `12,000`
  - Task 2: Fee `40,000` $\rightarrow$ Reward `16,000`
  - Task 3: Fee `50,000` $\rightarrow$ Reward `20,000`
  - Task 4: Fee `60,000` $\rightarrow$ Reward `24,000`
  - Task 5: Fee `70,000` $\rightarrow$ Reward `28,000`
  - Task 6: Fee `90,000` $\rightarrow$ Reward `36,000`
  - Task 7: Fee `110,000` $\rightarrow$ Reward `44,000`
  - Task 8: Fee `130,000` $\rightarrow$ Reward `52,000`
  - Task 9: Fee `150,000` $\rightarrow$ Reward `60,000`
  - Task 10: Fee `170,000` $\rightarrow$ Reward `68,000`
  - **Unlocking Rule for Level 4**: All 10 tasks in Level 4 are `AVAILABLE` (selectable in any order) once Level 3 is completed. **Completing just 1 task out of 10 in Level 4 marks Level 4 as completed (`requiredTaskCount = 1`) and unlocks Level 5 task participation.**
- **Levels 5–10**: 10 free tasks each (`isPaid = false`, `unlockFee = 0`, `rewardAmount = 0` / displayed as `TBD` until specified).
- **Visibility & Sequential Rules**:
  - In **Levels 1, 2, and 3**, tasks unlock strictly sequentially (`Task 1` $\rightarrow$ `Task 2` $\rightarrow$ ... $\rightarrow$ `Task 10`). **If a task in Levels 1–3 is locked (not yet reached), its task title, price, and reward are strictly hidden (`Locked Task #X`, `rewardAmount = 0`, `unlockFee = 0`, non-clickable) until it is unlocked to be completed.**
  - Once **Level 3 is completed and the user reaches Level 4**:
    - **All 10 tasks in Level 4 are immediately unlocked (`AVAILABLE`)** with their task titles, prepaid prices, and 40% commissions visible because all 10 are optional and the user only needs **1 task completed** to move to Level 5.
    - **Levels 4 through 10 all become unlocked/visible**, and the user can see all tasks and prices/rewards across Levels 4–10.
    - **Level 5 tasks remain `LOCKED` for participation until at least 1 task in Level 4 is `APPROVED`**, though their task titles and prices/rewards are visible once Level 4 is reached.
- **Prepaid Task Refund + Commission Payout**:
  - When a user unlocks a prepaid task, `unlockFee` is deducted from `Wallet.availableBalance`.
  - When the task is completed/approved, the user receives `unlockFee + rewardAmount` (principal + 40% commission) back into `Wallet.availableBalance`, and `Wallet.totalEarned` increments by `rewardAmount`.

### B. Level-Specific Withdrawal Requirement Notices (Manageable in Admin Panel)
- **Database Column**: `"Level"."withdrawalNotice"` (TEXT).
- **Admin Panel (`/adminpanal/levels`)**:
  - Contains two views: **Level Cards** and a dedicated **Withdrawal Notices (10 Levels)** quick editor.
  - Admin can customize the exact notice displayed to users for each level individually (e.g. Level 1: *"Complete Level 1 to unlock the withdrawal panel for the withdrawal"*, Level 4: *"Complete any of the tasks from Level 4 to unlock the withdrawal panel for Level 4 reward"*).
- **User Withdrawal Panel (`/app/withdrawals`)**:
  - Dynamically fetches and renders the withdrawal requirement notice corresponding to the user's current level (`withdrawalQuota.withdrawalNotice`).

### C. Referral / Invitation System (Admin-Only 100 Single-Use 6-Letter Codes)
- **User Self-Referral Deleted**: Clients **cannot** invite anyone. There is no user referral page, no invite link, and no personal referral code displayed in the User App or Admin User tables.
- **100 Official Admin Referral Codes (`/adminpanal/referral-codes` & `/adminpanal/referrals`)**:
  - Stored in PostgreSQL table `"AdminReferralCode"`.
  - Always maintains **100 `AVAILABLE` codes**.
  - **Format**: Exactly **6 alphabetical letters** in lowercase (e.g., `lbhyfr`), generated by `generateSixLetterCode()`.
  - **Case-Insensitive**: Registration and validation accept lowercase, uppercase, or mixed case (`lbhyfr`, `LBHYFR`, `Lbhyfr`) via `LOWER("code") = LOWER($1)`.
  - **Single-Use + Auto-Replenishment**: When a code is used during `/api/auth/register`, its status changes to `'USED'` (recording `usedById`, `usedByName`, `usedByPhone`, `usedAt`), and `replenishAvailableCodesTo100()` immediately generates **1 new 6-letter code** so available codes stay at **100**.

### D. Telegram Invitation Code Bot (`/api/telegram/*`)
- **Bot Token**: `9295985286:AAHb0EQFD-OMsd5bfrNgaPMTfkUDm4-Gph8`
- **Access Password**: `9989GHYRT89`
- **Database Table**: `"TelegramUser"` (`id`, `chatId`, `username`, `firstName`, `status`, `totalQuota`, `codesGenerated`, `remainingQuota`).
- **Initial Quota**: New clients receive **10 codes** upon entering the password.
- **Admin Quota Grant**: Admins can view all registered Telegram clients in `/adminpanal/referral-codes` under the "Telegram Clients & Quota" tab and grant additional codes (+10, +20, etc.).
- **Sub-Second Webhook Speed**: Webhook returns the message directly in the Telegram HTTP webhook response payload (0 extra roundtrips, instant reply).
- **Registration Flow**:
  - Unregistered client starts bot $\rightarrow$ asks for password.
  - When client sends `9989GHYRT89` $\rightarrow$ registers user with 10 codes quota and unlocks keyboard button `[code]`.
  - Registered client sends `/start` $\rightarrow$ immediately responds *"You have already registered!"* with remaining quota.
  - Registered client sends `"code"` $\rightarrow$ generates a random 6-letter available code, decrements remaining quota, and displays remaining quota.
  - When remaining quota reaches 0 $\rightarrow$ prompts client to contact administration for more codes.
- **Simple Used-Code Notification**: When a new user registers on the website with that code, the bot sends a simple, direct message to the client:
  `"This invitation code <code> is used to create the account with the name of <name>."`

### E. Per-User Isolation & Zero-Reload Updates
- Every user has independent `Wallet`, `UserLevelProgress` (10 rows per user), and `UserTaskProgress` (100 rows per user).
- Admin and user actions update only the affected user's state in memory without full-page reloads.

### D. UI Theme & Aesthetics
- **Login & Register Pages (`LoginPage.tsx`, `RegisterPage.tsx`, `AdminLoginPage.tsx`)**: **Luxury Midnight & Rich Gold** theme (`#070A12` deep obsidian background, `#0D1324/85` frosted glass cards, amber/gold borders and gradient buttons).
- **User Portal (`/app/*`)**: Royal Dark Navy (`#04132F`, `#071B3A`) with Royal Blue (`#1459E8`) and Gold (`#FFD45A`) accents.
- **Admin Portal (`/adminpanal/*`)**: High-density Light Mode (`#F5F8FC` background, `#FFFFFF` cards, `#2563EB` primary blue).

---

## 3. High-Speed File Map

### Backend (`backend/src/`)
| File Path | Responsibility |
| :--- | :--- |
| `backend/prisma/schema.prisma` | Prisma schema (`User`, `Wallet`, `Level`, `Task`, `UserLevelProgress`, `UserTaskProgress`, `TaskSubmission`, `DepositRequest`, `WithdrawalRequest`, `SpinPrize`, `UserSpinEntitlement`, `SpinHistory`, `WalletTransaction`, `SiteSetting`, `AdminUser`, `AdminAuditLog`). Note: `"AdminReferralCode"` is managed via raw SQL in `adminReferralService.ts`. |
| `backend/prisma/dataset10Levels.ts` | Canonical 10-level, 100-task dataset definition (Levels 1–10 pricing, 40% commissions, YouTube URLs). |
| `backend/src/services/taskDatasetService.ts` | `syncDatasetTasksToDatabase()` — upserts the 10 levels and 100 tasks from `dataset10Levels.ts`. |
| `backend/src/services/taskProgressionService.ts` | Core level/task unlocking engine: `getLevelTasksForUser()`, `recalculateUserLevelProgress()`, sequential checks for L1–L3, any-1-of-10 rule for L4, and L4–L10 visibility after L3. |
| `backend/src/services/adminReferralService.ts` | Manages `"AdminReferralCode"` table: `generateSixLetterCode()`, `replenishAvailableCodesTo100()`, `validateAdminReferralCode()`, `claimAdminReferralCode()`, `getAdminReferralCodesOverview()`. |
| `backend/src/routes/authRoutes.ts` | `POST /api/auth/register` (validates & claims 6-letter code case-insensitively, creates user + wallet + 10 `UserLevelProgress` + 100 `UserTaskProgress`, replenishes code pool to 100), `POST /api/auth/login`, `GET /api/auth/me`. |
| `backend/src/routes/taskRoutes.ts` | `GET /api/tasks/levels`, `GET /api/tasks/levels/:levelNumber`, `GET /api/tasks/:taskId`, `POST /api/tasks/:taskId/unlock` (prepaid task fee deduction), `POST /api/tasks/:taskId/complete` / `submit` (instant task completion & principal + reward credit). |
| `backend/src/routes/adminRoutes.ts` | All `/api/admin/*` endpoints: login, dashboard metrics, 10x10 task grid, user CRUD & balance/CP adjustments, task/submission approvals, deposits, withdrawals, spin wheel, and `/api/admin/referral-codes` (`GET`, `POST /generate`, `POST /create`). |
| `backend/src/routes/withdrawalRoutes.ts` | User withdrawal requests & level-based withdrawal quota calculation. |
| `backend/src/routes/depositRoutes.ts` | Manual deposit request submission (Easypaisa, JazzCash, Bank). |
| `backend/src/scripts/syncAllUsersProgress.ts` | Standalone script to sync all 10 levels, 100 tasks, and backfill `UserLevelProgress` & `UserTaskProgress` rows for every user in Supabase. |

### Frontend (`frontend/src/`)
| File Path | Responsibility |
| :--- | :--- |
| `frontend/src/App.tsx` | Public & User route definitions (`/`, `/login`, `/register`, `/app/*`, `/adminpanal/*`). |
| `frontend/src/AdminApp.tsx` | Admin Panel route definitions (`/adminpanal/dashboard`, `users`, `levels`, `tasks`, `submissions`, `deposits`, `withdrawals`, `wallets`, `spin`, `referral-codes`, `referrals`, `transactions`, `settings`). |
| `frontend/src/api/client.ts` | Centralized fetch client with caching (`getCachedData`, `invalidateCache`) and all User + Admin API methods. |
| `frontend/src/pages/public/LoginPage.tsx` | User Login page (Luxury Midnight & Rich Gold theme). |
| `frontend/src/pages/public/RegisterPage.tsx` | User Registration page (Luxury Midnight & Rich Gold theme, 6-letter case-insensitive referral code input). |
| `frontend/src/pages/user/DashboardPage.tsx` | User Home dashboard (Wallet balance, Credit Points, Level progress, Quick Actions, Recent Activity). |
| `frontend/src/pages/user/TasksPage.tsx` | 10-Level switcher & task list UI (displays per-task rewards, prepaid badges, L4–L10 visibility). |
| `frontend/src/pages/user/TaskDetailPage.tsx` | Individual task execution page (45s/30s timer, prepaid unlock button, instant completion). |
| `frontend/src/pages/admin/AdminLoginPage.tsx` | Admin Login page (Luxury Midnight & Rich Gold theme). |
| `frontend/src/pages/admin/AdminReferralCodesPage.tsx` | Admin 100 Referral Codes page (`Available Codes` & `Used Codes` tabs, 1-click copy, search, `+10 Codes` generator). |
| `frontend/src/pages/admin/AdminReferralsPage.tsx` | Re-exports `AdminReferralCodesPage` so `/adminpanal/referrals` and `/adminpanal/referral-codes` show the exact same 100-code interface. |
| `frontend/src/pages/admin/AdminUsersPage.tsx` | Resizable member management table with per-user instant state updates (balance, credit points, password reset, status toggle). |
| `frontend/src/pages/admin/AdminUserDetailPage.tsx` | Detailed single-member view (overview, tasks, wallet ledger, deposits, withdrawals, spin history). |
| `frontend/src/pages/admin/AdminLevelsPage.tsx` | Admin Level Management (titles, descriptions, 10 task slots per level). |
| `frontend/src/pages/admin/AdminTasksPage.tsx` | Admin 10x10 Task Grid & Task Editor modal. |
| `frontend/src/pages/admin/AdminSettingsPage.tsx` | Maintenance Mode controller, receiving bank/mobile wallet accounts, and global spin wheel toggle. |

---

## 4. Database Connection & Gotchas

- **Database**: Supabase PostgreSQL (`vzgjygtbdkezaerygjbp`, region `ap-northeast-1` Tokyo).
- **Environment File**: `backend/.env` holds `DATABASE_URL` (port `6543` pgbouncer pooler) and `DIRECT_URL` (port `5432`).
- **Prisma Raw Queries Gotcha**:
  1. Because `DATABASE_URL` uses pgbouncer (`?pgbouncer=true`), **`prisma.$executeRawUnsafe` cannot run multi-statement SQL strings** (Postgres error `42601`). Always execute one SQL statement per `$executeRawUnsafe` call.
  2. Always type raw queries as `prisma.$queryRawUnsafe<any[]>(...)` so TypeScript strict builds on Vercel do not fail with `TS2322` (`unknown` vs `any[]`).

---

## 5. Standard Verification & Push Workflow

Whenever finishing a code change, run this single verification sequence:

```bash
# 1. Sync mirror files if backend/frontend were edited
cp backend/src/services/adminReferralService.ts src/server/services/adminReferralService.ts

# 2. Type-check and build both Backend (updates api/index.js) and Frontend
(cd backend && npx tsc --noEmit && npm run build) && (cd frontend && npx tsc --noEmit && npm run build)

# 3. Commit and push both repositories
(cd backend && git add -A && git commit -m "<message>" && git push origin main)
(cd frontend && git add -A && git commit -m "<message>" && git push origin main)
```

