import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { taskProgressionService } from '../services/taskProgressionService';
import { ledgerService, InsufficientBalanceError } from '../services/ledgerService';
import { affiliateService } from '../services/affiliateService';
import { sendUserLiveCommand } from '../utils/supabase';
import { syncDatasetTasksToDatabase } from '../services/taskDatasetService';

const router = Router();

/**
 * GET /api/tasks/levels
 * Lists all 10 levels with user completion progress
 */
router.get('/levels', requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.user!.id;
    await syncDatasetTasksToDatabase();
    const [levels, userProgress, userLevelProgressList, approvedSubmissions, userWithdrawals, userLevelUnlocks] = await Promise.all([
      prisma.level.findMany({ orderBy: { levelNumber: 'asc' } }),
      prisma.userTaskProgress.findMany({
        where: { userId, status: 'APPROVED' },
        select: { task: { select: { levelId: true, id: true } } },
      }),
      prisma.userLevelProgress.findMany({
        where: { userId },
      }),
      prisma.taskSubmission.findMany({
        where: { userId, status: 'APPROVED' },
        select: { task: { select: { levelId: true, id: true } } },
      }),
      prisma.withdrawalRequest.findMany({
        where: { userId, approvalStatus: { in: ['PENDING', 'APPROVED'] } },
        select: { id: true, notes: true },
      }),
      prisma.userLevelUnlock.findMany({
        where: { userId, isApproved: true },
        select: { levelNumber: true },
      }),
    ]);

    const approvedLevelNumbers = new Set(userLevelUnlocks.map((u) => u.levelNumber));

    const approvedTasksByLevel = new Map<string, Set<string>>();
    for (const p of userProgress) {
      if (p.task?.levelId && p.task?.id) {
        if (!approvedTasksByLevel.has(p.task.levelId)) {
          approvedTasksByLevel.set(p.task.levelId, new Set());
        }
        approvedTasksByLevel.get(p.task.levelId)!.add(p.task.id);
      }
    }
    for (const s of approvedSubmissions) {
      if (s.task?.levelId && s.task?.id) {
        if (!approvedTasksByLevel.has(s.task.levelId)) {
          approvedTasksByLevel.set(s.task.levelId, new Set());
        }
        approvedTasksByLevel.get(s.task.levelId)!.add(s.task.id);
      }
    }

    const levelProgressMap = new Map<string, any>();
    for (const lp of userLevelProgressList) {
      levelProgressMap.set(lp.levelId, lp);
    }

    const levelStats = new Map<number, { level: any; approvedCount: number; isCompleted: boolean }>();
    for (const lvl of levels) {
      const taskSet = approvedTasksByLevel.get(lvl.id);
      const lp = levelProgressMap.get(lvl.id);
      const approvedCount = Math.max(taskSet ? taskSet.size : 0, lp?.approvedTaskCount || 0);
      const isCompleted =
        lvl.levelNumber === 4
          ? approvedCount >= 1
          : approvedCount >= (lvl.requiredTaskCount || 10) || lp?.completionStatus === 'COMPLETED';
      levelStats.set(lvl.levelNumber, { level: lvl, approvedCount, isCompleted });
    }

    const level1Completed = levelStats.get(1)?.isCompleted || false;
    const level2Completed = level1Completed && (levelStats.get(2)?.isCompleted || false);
    const level3Completed = level2Completed && (levelStats.get(3)?.isCompleted || false);
    const level4Completed = level3Completed && (levelStats.get(4)?.isCompleted || false);

    const hasWithdrawnLevel1 = userWithdrawals.length > 0;

    const levelsWithProgress = levels.map((lvl) => {
      const stats = levelStats.get(lvl.levelNumber)!;
      let isUnlocked = false;
      let lockReason: string | null = null;
      if (lvl.levelNumber === 1) {
        isUnlocked = true;
      } else if (lvl.levelNumber === 2) {
        // Level 2 unlocks automatically when Level 1 is completed
        isUnlocked = level1Completed;
        if (!isUnlocked) {
          lockReason = 'Complete all tasks in Level 1 first to unlock Level 2.';
        }
      } else if (lvl.levelNumber === 3) {
        // Level 3 unlocks automatically when Level 2 is completed
        isUnlocked = level2Completed;
        if (!isUnlocked) {
          lockReason = 'Complete all tasks in Level 2 first to unlock Level 3.';
        }
      } else if (lvl.levelNumber === 4) {
        // Level 4 requires Level 3 completed AND manual admin approval
        isUnlocked = level3Completed && approvedLevelNumbers.has(4);
        if (!isUnlocked) {
          lockReason = level3Completed
            ? 'Level 4 requires administrator approval to unlock.'
            : 'Complete all tasks in Level 3 first to unlock Level 4.';
        }
      } else if (lvl.levelNumber === 5) {
        // Level 5 requires Level 4 completed AND manual admin approval
        isUnlocked = level4Completed && approvedLevelNumbers.has(5);
        if (!isUnlocked) {
          lockReason = level4Completed
            ? 'Level 5 requires administrator approval to unlock.'
            : 'Complete any one task in Level 4 to unlock Level 5.';
        }
      } else {
        const prevLevelCompleted = levelStats.get(lvl.levelNumber - 1)?.isCompleted || false;
        isUnlocked = prevLevelCompleted && approvedLevelNumbers.has(lvl.levelNumber);
        if (!isUnlocked) {
          lockReason = prevLevelCompleted
            ? `Level ${lvl.levelNumber} requires administrator approval to unlock.`
            : `Complete all tasks in Level ${lvl.levelNumber - 1} first to unlock Level ${lvl.levelNumber}.`;
        }
      }

      return {
        id: lvl.id,
        levelNumber: lvl.levelNumber,
        title: lvl.title,
        description: lvl.description,
        status: lvl.status,
        requiredTaskCount: lvl.requiredTaskCount,
        completionReward: lvl.completionReward,
        totalCreditPoints: 0,
        approvedTaskCount: stats.approvedCount,
        isCompleted: stats.isCompleted,
        isUnlocked,
        lockReason,
      };
    });

    const isLevel4Reached = Boolean(
      (level3Completed && approvedLevelNumbers.has(4)) ||
      (levelStats.get(4)?.approvedCount || 0) > 0 ||
      level4Completed
    );

    res.json({ levels: levelsWithProgress, isLevel4Reached });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tasks/levels/:levelNumber
 * Returns evaluated tasks for a specific level with sequential prerequisite logic
 */
router.get('/levels/:levelNumber', requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.user!.id;
    const levelNumber = parseInt(req.params.levelNumber as string, 10);

    if (isNaN(levelNumber) || levelNumber < 1 || levelNumber > 10) {
      return res.status(400).json({ error: 'Valid standard level number between 1 and 10 is required' });
    }

    const result = await taskProgressionService.getLevelTasksForUser(userId, levelNumber);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

async function findTaskByIdOrSynthetic(taskId: string) {
  // 1. Direct ID match
  let task: any = await prisma.task.findUnique({
    where: { id: taskId },
    include: { level: true },
  });
  if (task) return task;

  // 2. Synthetic or formatted ID match (e.g. "completed-lvl-2-task-10", "locked-lvl-2-task-10", "task-2-10", "task_2_10")
  const match =
    taskId.match(/(?:lvl|level)[-_](\d+)[-_]task[-_](\d+)/i) ||
    taskId.match(/^task[-_](\d+)[-_](\d+)$/i);
  if (match) {
    const levelNumber = parseInt(match[1], 10);
    const taskNumber = parseInt(match[2], 10);
    const level = await prisma.level.findUnique({ where: { levelNumber } });
    if (level) {
      task = await prisma.task.findUnique({
        where: {
          levelId_taskNumber: {
            levelId: level.id,
            taskNumber,
          },
        },
        include: { level: true },
      });
      if (task) return task;
    }
  }

  return null;
}

/**
 * GET /api/tasks/:taskId
 * Single task details
 */
router.get('/:taskId', requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.user!.id;
    const taskId = req.params.taskId as string;

    const task: any = await findTaskByIdOrSynthetic(taskId);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const { tasks, isLevelUnlocked } = await taskProgressionService.getLevelTasksForUser(userId, task.level.levelNumber);

    const evaluatedTask = tasks.find((t) => t.id === task.id || t.id === taskId || t.taskNumber === task.taskNumber);
    if (!evaluatedTask) {
      return res.status(404).json({ error: 'Task evaluation failed' });
    }

    // Past submissions
    const submissions = await prisma.taskSubmission.findMany({
      where: { userId, taskId: task.id },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      task: evaluatedTask,
      level: task.level,
      isLevelUnlocked,
      submissions,
    });
  } catch (err) {
    next(err);
  }
});



/**
 * POST /api/tasks/:taskId/unlock
 * Paid task unlocking workflow - verifies account balance and queues task for admin review
 */
router.post('/:taskId/unlock', requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.user!.id;
    const taskId = req.params.taskId as string;

    const task: any = await findTaskByIdOrSynthetic(taskId);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (!task.isPaid || task.unlockFee <= 0) {
      return res.status(400).json({ error: 'This task is free and does not require an unlock fee' });
    }

    // Validate level and prerequisite task
    const { tasks, isLevelUnlocked } = await taskProgressionService.getLevelTasksForUser(userId, task.level.levelNumber);
    if (!isLevelUnlocked) {
      if (task.level.levelNumber === 2) {
        return res.status(403).json({
          error: 'Level 2 is locked. You must withdraw your total account balance from Level 1 before you can start Level 2 tasks.',
        });
      }
      return res.status(403).json({ error: `Level ${task.level.levelNumber} is locked. Complete all tasks in the previous level first.` });
    }

    const evaluated = tasks.find((t) => t.id === task.id || t.id === taskId || t.taskNumber === task.taskNumber);
    if (!evaluated) {
      return res.status(404).json({ error: 'Task evaluation error' });
    }

    if (evaluated.userStatus === 'APPROVED') {
      return res.status(400).json({ error: 'This task is already completed and approved' });
    }

    if (evaluated.userStatus === 'PENDING_VERIFICATION') {
      return res.status(400).json({ error: 'This task is already awaiting admin approval' });
    }

    if (task.level.levelNumber === 4) {
      const otherApproved = tasks.some((t) => t.id !== task.id && t.userStatus === 'APPROVED');
      if (otherApproved) {
        return res.status(403).json({
          error: 'Level 4 allows only one task to be completed. You have already completed your Level 4 task. Please proceed to Level 5!',
        });
      }
      const otherPending = tasks.some((t) => t.id !== task.id && t.userStatus === 'PENDING_VERIFICATION');
      if (otherPending) {
        return res.status(403).json({
          error: 'You have already submitted a Level 4 task awaiting approval. Only one task can be completed in Level 4.',
        });
      }
    }

    if (evaluated.userStatus === 'LOCKED') {
      return res.status(403).json({ error: evaluated.lockMessage || 'Prerequisite tasks must be approved before unlocking this task' });
    }

    // Validate user wallet balance
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet || wallet.availableBalance < task.unlockFee) {
      const currentBal = wallet?.availableBalance || 0;
      const remainingNeeded = Math.max(0, task.unlockFee - currentBal);
      return res.status(400).json({
        error: `Insufficient account balance. This prepaid task requires an account balance of PKR ${task.unlockFee.toLocaleString()} to submit for approval (Available: PKR ${currentBal.toLocaleString()}). Please deposit PKR ${remainingNeeded.toLocaleString()} to complete the required balance.`,
        requiredAmount: task.unlockFee,
        availableBalance: currentBal,
        remainingNeeded,
        redirectToDeposit: true,
      });
    }

    // Balance requirement verified! Submit for admin review (zero balance deducted)
    const result = await prisma.$transaction(async (tx) => {
      const unlockTx = await tx.taskUnlockTransaction.create({
        data: {
          userId,
          taskId: task.id,
          unlockFee: 0,
          transactionId: `tx_unlock_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          status: 'COMPLETED',
        },
      });

      const submission = await tx.taskSubmission.create({
        data: {
          userId,
          taskId: task.id,
          submissionNotes: `Prepaid task opened (Account balance requirement of PKR ${task.unlockFee.toLocaleString()} verified). Submitted for admin review.`,
          proofEvidence: null,
          status: 'PENDING',
        },
      });

      const progress = await tx.userTaskProgress.upsert({
        where: { userId_taskId: { userId, taskId: task.id } },
        update: {
          status: 'PENDING_VERIFICATION',
          isPaidUnlocked: true,
          unlockedAt: new Date(),
          submissionAt: new Date(),
        },
        create: {
          userId,
          taskId: task.id,
          status: 'PENDING_VERIFICATION',
          isPaidUnlocked: true,
          unlockedAt: new Date(),
          submissionAt: new Date(),
        },
      });

      const rewardText = task.rewardAmount > 0 ? ` Upon admin approval, +PKR ${task.rewardAmount.toLocaleString()} reward will be directly credited to your account.` : '';
      await tx.notification.create({
        data: {
          userId,
          title: `Prepaid Task Submitted for Review ⏳`,
          message: `Required account balance of PKR ${task.unlockFee.toLocaleString()} verified. Task "${task.title}" has been submitted for admin review and approval. Your funds remain in your wallet balance with zero deductions.${rewardText}`,
          notificationType: 'TASK_STATUS',
        },
      });

      return { progress, unlockTx, submission };
    });

    sendUserLiveCommand(userId, 'task', { taskId: task.id, status: 'PENDING_VERIFICATION' });
    sendUserLiveCommand(userId, 'refresh', { type: 'TASK_SUBMITTED' });

    res.json({
      message: `Prepaid task opened and submitted for admin review! An administrator will review and approve the task. Your funds remain in your account balance with zero deductions.`,
      task: {
        id: task.id,
        title: task.title,
        instructions: task.instructions,
        protectedUrl: task.protectedUrl,
        userStatus: 'PENDING_VERIFICATION',
        isPaidUnlocked: true,
      },
      submission: result.submission,
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/tasks/:taskId/submit
 * User submits confirmation reference or task notes for admin review
 */
router.post('/:taskId/submit', requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.user!.id;
    const taskId = req.params.taskId as string;

    const schema = z.object({
      submissionNotes: z.string().max(1000).optional().default('Task completed - submitted for review'),
      proofEvidence: z.string().optional().nullable(),
    });
    const validated = schema.parse(req.body || {});

    const task: any = await findTaskByIdOrSynthetic(taskId);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const { tasks, isLevelUnlocked } = await taskProgressionService.getLevelTasksForUser(userId, task.level.levelNumber);
    if (!isLevelUnlocked) {
      if (task.level.levelNumber === 2) {
        return res.status(403).json({
          error: 'Level 2 is locked. You must withdraw your total account balance from Level 1 before you can complete Level 2 tasks.',
        });
      }
      return res.status(403).json({ error: 'This level is locked' });
    }

    const evaluated = tasks.find((t) => t.id === task.id || t.id === taskId || t.taskNumber === task.taskNumber);
    if (!evaluated) {
      return res.status(404).json({ error: 'Task evaluation error' });
    }

    if (evaluated.userStatus === 'APPROVED') {
      return res.status(400).json({ error: 'This task has already been completed and approved' });
    }

    if (evaluated.userStatus === 'PENDING_VERIFICATION') {
      return res.status(400).json({ error: 'A submission for this task is already awaiting admin verification' });
    }

    if (task.level.levelNumber === 4) {
      const otherApproved = tasks.some((t) => t.id !== task.id && t.userStatus === 'APPROVED');
      if (otherApproved) {
        return res.status(403).json({
          error: 'Level 4 allows only one task to be completed. You have already completed your Level 4 task. Please proceed to Level 5!',
        });
      }
      const otherPending = tasks.some((t) => t.id !== task.id && t.userStatus === 'PENDING_VERIFICATION');
      if (otherPending) {
        return res.status(403).json({
          error: 'You have already submitted a Level 4 task awaiting approval. Only one task can be completed in Level 4.',
        });
      }
    }

    if (evaluated.userStatus === 'LOCKED') {
      return res.status(403).json({ error: evaluated.lockMessage || 'This task is locked' });
    }

    // If it's a prepaid task, client must be at the required account balance upon submitting approval
    if (task.isPaid) {
      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      const currentBal = wallet?.availableBalance || 0;
      if (currentBal < task.unlockFee) {
        const remainingNeeded = Math.max(0, task.unlockFee - currentBal);
        return res.status(400).json({
          error: `Insufficient account balance. This prepaid task requires an account balance of PKR ${task.unlockFee.toLocaleString()} to submit for approval (Available: PKR ${currentBal.toLocaleString()}). Please deposit PKR ${remainingNeeded.toLocaleString()} to complete the required balance.`,
          requiredAmount: task.unlockFee,
          availableBalance: currentBal,
          remainingNeeded,
          redirectToDeposit: true,
        });
      }
    }

    // Record submission for admin review
    const submission = await prisma.$transaction(async (tx) => {
      if (task.isPaid) {
        await tx.taskUnlockTransaction.create({
          data: {
            userId,
            taskId: task.id,
            unlockFee: 0,
            transactionId: `tx_unlock_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            status: 'COMPLETED',
          },
        });
      }

      const sub = await tx.taskSubmission.create({
        data: {
          userId,
          taskId: task.id,
          submissionNotes: validated.submissionNotes || (task.isPaid ? `Prepaid task submitted (Account balance requirement of PKR ${task.unlockFee.toLocaleString()} verified)` : 'Task completed'),
          proofEvidence: validated.proofEvidence || null,
          status: 'PENDING',
        },
      });

      await tx.userTaskProgress.upsert({
        where: { userId_taskId: { userId, taskId: task.id } },
        update: {
          status: 'PENDING_VERIFICATION',
          isPaidUnlocked: task.isPaid ? true : undefined,
          submissionAt: new Date(),
        },
        create: {
          userId,
          taskId: task.id,
          status: 'PENDING_VERIFICATION',
          isPaidUnlocked: task.isPaid ? true : false,
          submissionAt: new Date(),
        },
      });

      const rewardInfo = task.rewardAmount > 0 ? ` Upon approval, +PKR ${task.rewardAmount.toLocaleString()} reward will be credited directly to your account.` : '';
      await tx.notification.create({
        data: {
          userId,
          title: task.isPaid ? `Prepaid Task Submitted for Review ⏳` : `Task Submitted: ${task.title} ⏳`,
          message: task.isPaid
            ? `Required balance of PKR ${task.unlockFee.toLocaleString()} verified. Task "${task.title}" has been automatically submitted for admin review and approval. Your funds remain in your balance with zero deductions.${rewardInfo}`
            : `Your submission has been queued for admin verification and approval. You will be notified once reviewed.${rewardInfo}`,
          notificationType: 'TASK_STATUS',
        },
      });

      return sub;
    });

    sendUserLiveCommand(userId, 'task', { taskId: task.id, taskNumber: task.taskNumber, status: 'PENDING_VERIFICATION' });
    sendUserLiveCommand(userId, 'refresh', { type: 'TASK_SUBMITTED' });

    res.status(201).json({
      message: task.isPaid
        ? `Prepaid task approved & submitted for review! Required account balance verified. Your funds remain in your balance, and +PKR ${task.rewardAmount.toLocaleString()} reward will be credited upon admin approval.`
        : 'Task submitted for review! Once approved by admin, your reward will be added to your balance and the next task will open.',
      submission,
      userStatus: 'PENDING_VERIFICATION',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
