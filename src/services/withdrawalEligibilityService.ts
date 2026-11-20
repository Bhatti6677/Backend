import { prisma } from '../prisma';
import { getAllLevelWithdrawalNotices } from './levelNoticeService';
import { ensureUserWithdrawalColumns } from '../utils/ensureSchema';

export interface WithdrawalEligibility {
  isLocked: boolean;
  lockReason: 'LEVEL_1_NOT_COMPLETED' | 'LEVEL_2_NOT_COMPLETED' | 'LEVEL_3_NOT_COMPLETED' | 'ADMIN_LOCKED' | null;
  stage: 'LOCKED_BEFORE_L1' | 'LEVEL_1' | 'LOCKED_BEFORE_L2' | 'LEVEL_2' | 'LOCKED_BEFORE_L3' | 'UNRESTRICTED' | 'ADMIN_LOCKED';
  eligiblePercent: number; // 0 or 100
  maxWithdrawableAmount: number;
  availableBalance: number;
  isUnrestricted: boolean;
  withdrawalNotice: string;
  hasWithdrawnLevel1: boolean;
  hasWithdrawnLevel2: boolean;
  completedLevelsCount: number;
  currentLevelNumber: number;
  isAdminLocked?: boolean;
  adminLockReason?: string | null;
}

/**
 * Calculates current withdrawal eligibility and stage for a specific user:
 * - Admin lock active: Withdrawal is immediately LOCKED with the admin's reason.
 * - Before Level 1 completed: Withdrawal is LOCKED.
 * - Level 1 completed: User can withdraw full balance (100%). Level 2 tasks are locked until Level 1 balance is withdrawn.
 * - After Level 1 balance withdrawn: Withdrawal is LOCKED until Level 2 completion.
 * - Level 2 completed: User requests full balance (100%). Upon approval, 10% is disbursed, 90% returns to account, and withdrawal is LOCKED again.
 * - Level 3 completed: User can withdraw any amount at any time (even 100% or any %) with zero restrictions.
 */
export async function getWithdrawalEligibility(userId: string): Promise<WithdrawalEligibility> {
  const [wallet, user, levels, userTaskProgress, userLevelProgress, userSubmissions, withdrawals, notices] =
    await Promise.all([
      prisma.wallet.findUnique({
        where: { userId },
        select: { availableBalance: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { isWithdrawalLocked: true, withdrawalLockReason: true },
      }).catch(async (err) => {
        if (String(err?.message).includes('isWithdrawalLocked') || String(err?.message).includes('column')) {
          await ensureUserWithdrawalColumns(prisma);
          return prisma.user.findUnique({
            where: { id: userId },
            select: { isWithdrawalLocked: true, withdrawalLockReason: true },
          }).catch(() => null);
        }
        return null;
      }),
      prisma.level.findMany({
        select: { id: true, levelNumber: true, requiredTaskCount: true },
        orderBy: { levelNumber: 'asc' },
      }),
      prisma.userTaskProgress.findMany({
        where: { userId, status: 'APPROVED' },
        select: { task: { select: { levelId: true, id: true } } },
      }),
      prisma.userLevelProgress.findMany({
        where: { userId },
        select: { levelId: true, approvedTaskCount: true, completionStatus: true },
      }),
      prisma.taskSubmission.findMany({
        where: { userId, status: 'APPROVED' },
        select: { task: { select: { levelId: true, id: true } } },
      }),
      prisma.withdrawalRequest.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      }),
      getAllLevelWithdrawalNotices(),
    ]);

  const availableBalance = wallet?.availableBalance || 0;

  // Check admin manual lock first
  if (user?.isWithdrawalLocked) {
    const lockNotice = user.withdrawalLockReason?.trim() || 'Your withdrawal access has been temporarily locked by administration.';
    return {
      isLocked: true,
      lockReason: 'ADMIN_LOCKED',
      stage: 'ADMIN_LOCKED',
      eligiblePercent: 0,
      maxWithdrawableAmount: 0,
      availableBalance,
      isUnrestricted: false,
      withdrawalNotice: lockNotice,
      hasWithdrawnLevel1: false,
      hasWithdrawnLevel2: false,
      completedLevelsCount: 0,
      currentLevelNumber: 1,
      isAdminLocked: true,
      adminLockReason: lockNotice,
    };
  }

  const approvedTasksByLevel = new Map<string, Set<string>>();
  for (const p of userTaskProgress) {
    if (p.task?.levelId && p.task?.id) {
      if (!approvedTasksByLevel.has(p.task.levelId)) {
        approvedTasksByLevel.set(p.task.levelId, new Set());
      }
      approvedTasksByLevel.get(p.task.levelId)!.add(p.task.id);
    }
  }
  for (const s of userSubmissions) {
    if (s.task?.levelId && s.task?.id) {
      if (!approvedTasksByLevel.has(s.task.levelId)) {
        approvedTasksByLevel.set(s.task.levelId, new Set());
      }
      approvedTasksByLevel.get(s.task.levelId)!.add(s.task.id);
    }
  }

  const levelProgressByLevelId = new Map(userLevelProgress.map((lp) => [lp.levelId, lp]));

  let completedLevelsCount = 0;
  let l1Completed = false;
  let l2Completed = false;
  let l3Completed = false;

  for (const lvl of levels) {
    const taskSet = approvedTasksByLevel.get(lvl.id);
    const lp = levelProgressByLevelId.get(lvl.id);
    const approvedCount = Math.max(taskSet ? taskSet.size : 0, lp?.approvedTaskCount || 0);
    const isCompleted =
      lvl.levelNumber === 4
        ? approvedCount >= 1
        : approvedCount >= (lvl.requiredTaskCount || 10) || lp?.completionStatus === 'COMPLETED';

    if (isCompleted) {
      completedLevelsCount++;
      if (lvl.levelNumber === 1) l1Completed = true;
      if (lvl.levelNumber === 2 && l1Completed) l2Completed = true;
      if (lvl.levelNumber === 3 && l2Completed) l3Completed = true;
    }
  }

  // Inspect user's non-rejected withdrawal history
  const validWithdrawals = withdrawals.filter((w) => w.approvalStatus !== 'REJECTED');

  const hasWithdrawnLevel1 = validWithdrawals.some(
    (w) =>
      w.notes?.includes('[LEVEL_1_WITHDRAWAL]') ||
      (!w.notes?.includes('[LEVEL_2_WITHDRAWAL]') && !w.notes?.includes('[UNRESTRICTED_WITHDRAWAL]'))
  );

  const hasWithdrawnLevel2 = validWithdrawals.some(
    (w) =>
      w.notes?.includes('[LEVEL_2_WITHDRAWAL]') ||
      (validWithdrawals.length >= 2 && !w.notes?.includes('[UNRESTRICTED_WITHDRAWAL]'))
  );

  const currentLevelNumber = Math.min(10, completedLevelsCount + 1);

  // Stage 0: Level 1 not completed -> Locked
  if (!l1Completed) {
    return {
      isLocked: true,
      lockReason: 'LEVEL_1_NOT_COMPLETED',
      stage: 'LOCKED_BEFORE_L1',
      eligiblePercent: 0,
      maxWithdrawableAmount: 0,
      availableBalance,
      isUnrestricted: false,
      withdrawalNotice:
        notices[1] || 'Complete Level 1 to unlock the withdrawal panel for the withdrawal',
      hasWithdrawnLevel1: false,
      hasWithdrawnLevel2: false,
      completedLevelsCount,
      currentLevelNumber,
    };
  }

  // Stage 1: Level 1 completed, Level 1 withdrawal not yet submitted -> Unlocked for 100% full account balance
  if (l1Completed && !hasWithdrawnLevel1) {
    return {
      isLocked: false,
      lockReason: null,
      stage: 'LEVEL_1',
      eligiblePercent: 100,
      maxWithdrawableAmount: availableBalance,
      availableBalance,
      isUnrestricted: false,
      withdrawalNotice:
        notices[1] || 'Level 1 completed! Withdraw your total account balance to unlock Level 2 tasks.',
      hasWithdrawnLevel1: false,
      hasWithdrawnLevel2: false,
      completedLevelsCount,
      currentLevelNumber,
    };
  }

  // Stage 2: Level 1 withdrawal made, Level 2 not completed yet -> Locked
  if (l1Completed && hasWithdrawnLevel1 && !l2Completed) {
    return {
      isLocked: true,
      lockReason: 'LEVEL_2_NOT_COMPLETED',
      stage: 'LOCKED_BEFORE_L2',
      eligiblePercent: 0,
      maxWithdrawableAmount: 0,
      availableBalance,
      isUnrestricted: false,
      withdrawalNotice:
        notices[2] || 'Complete Level 2 to unlock the withdrawal panel for Level 2 reward',
      hasWithdrawnLevel1: true,
      hasWithdrawnLevel2: false,
      completedLevelsCount,
      currentLevelNumber,
    };
  }

  // Stage 3: Level 2 completed, Level 2 withdrawal not yet submitted -> Unlocked to request full balance (10% payout / 90% return upon approval)
  if (l2Completed && !hasWithdrawnLevel2) {
    return {
      isLocked: false,
      lockReason: null,
      stage: 'LEVEL_2',
      eligiblePercent: 100,
      maxWithdrawableAmount: availableBalance,
      availableBalance,
      isUnrestricted: false,
      withdrawalNotice:
        notices[2] ||
        'Level 2 completed! Request withdrawal of your full account balance for administration review.',
      hasWithdrawnLevel1: true,
      hasWithdrawnLevel2: false,
      completedLevelsCount,
      currentLevelNumber,
    };
  }

  // Stage 4: Level 2 withdrawal submitted, Level 3 not completed yet -> Locked again
  if (l2Completed && hasWithdrawnLevel2 && !l3Completed) {
    return {
      isLocked: true,
      lockReason: 'LEVEL_3_NOT_COMPLETED',
      stage: 'LOCKED_BEFORE_L3',
      eligiblePercent: 0,
      maxWithdrawableAmount: 0,
      availableBalance,
      isUnrestricted: false,
      withdrawalNotice:
        notices[3] || 'Complete Level 3 to unlock unlimited withdrawals',
      hasWithdrawnLevel1: true,
      hasWithdrawnLevel2: true,
      completedLevelsCount,
      currentLevelNumber,
    };
  }

  // Stage 5: Level 3 completed (L3+) -> Unrestricted withdrawals forever
  return {
    isLocked: false,
    lockReason: null,
    stage: 'UNRESTRICTED',
    eligiblePercent: 100,
    maxWithdrawableAmount: availableBalance,
    availableBalance,
    isUnrestricted: true,
    withdrawalNotice:
      'All Level 3 tasks completed! Withdrawals are fully unlocked with zero restrictions. You can withdraw any amount from your balance at any time.',
    hasWithdrawnLevel1: true,
    hasWithdrawnLevel2: true,
    completedLevelsCount,
    currentLevelNumber,
  };
}

