import { prisma } from '../prisma';
import { affiliateService } from './affiliateService';

export interface EvaluatedTask {
  id: string;
  levelId: string;
  taskNumber: number;
  title: string;
  description: string;
  taskType: string;
  rewardAmount: number;
  creditPoints: number;
  isPaid: boolean;
  unlockFee: number;
  requiresAdminApproval: boolean;
  status: string; // Task entity status (ACTIVE, DISABLED)
  // Progression fields computed for this user:
  userStatus: 'LOCKED' | 'AVAILABLE' | 'AWAITING_PAYMENT' | 'UNLOCKED' | 'IN_PROGRESS' | 'PENDING_VERIFICATION' | 'APPROVED' | 'REJECTED' | 'DISABLED';
  isPaidUnlocked: boolean;
  lockMessage: string;
  instructions: string | null;
  protectedUrl: string | null;
  submissionInstructions: string | null;
  externalContact: string | null;
  submission?: any | null;
}

export const taskProgressionService = {
  /**
   * Evaluates sequential task progression for a user in a specific level
   */
  async getLevelTasksForUser(userId: string, levelNumber: number): Promise<{ level: any; tasks: EvaluatedTask[]; isLevelUnlocked: boolean; isLevel4Reached?: boolean }> {
    const level = await prisma.level.findUnique({
      where: { levelNumber },
      include: {
        tasks: {
          orderBy: { taskNumber: 'asc' },
        },
      },
    });

    if (!level) {
      throw new Error(`Level ${levelNumber} not found`);
    }

    // Single parallel query roundtrip for all level progression & current level data
    const [
      allLevels,
      userTaskProgressList,
      userLevelProgressList,
      userSubmissionsList,
      wallet,
      currentLevelProgressRecords,
      currentLevelSubmissions,
      userWithdrawalsList,
      userLevelUnlocks,
    ] = await Promise.all([
      prisma.level.findMany({
        select: { id: true, levelNumber: true, requiredTaskCount: true },
        orderBy: { levelNumber: 'asc' },
      }),
      prisma.userTaskProgress.findMany({
        where: { userId, status: 'APPROVED' },
        select: { status: true, task: { select: { levelId: true, id: true } } },
      }),
      prisma.userLevelProgress.findMany({
        where: { userId },
        select: { levelId: true, approvedTaskCount: true, completionStatus: true },
      }),
      prisma.taskSubmission.findMany({
        where: { userId, status: 'APPROVED' },
        select: { status: true, task: { select: { levelId: true, id: true } } },
      }),
      prisma.wallet.findUnique({
        where: { userId },
        select: { availableBalance: true },
      }),
      prisma.userTaskProgress.findMany({
        where: {
          userId,
          task: { levelId: level.id },
        },
      }),
      prisma.taskSubmission.findMany({
        where: {
          userId,
          task: { levelId: level.id },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.withdrawalRequest.findMany({
        where: { userId, approvalStatus: { in: ['PENDING', 'APPROVED'] } },
        select: { id: true, notes: true, approvalStatus: true },
      }),
      prisma.userLevelUnlock.findMany({
        where: { userId, isApproved: true },
        select: { levelNumber: true },
      }),
    ]);

    const approvedLevelNumbers = new Set(userLevelUnlocks.map((u) => u.levelNumber));

    // Compute approved tasks count per level
    const approvedTasksByLevelId = new Map<string, Set<string>>();
    for (const p of userTaskProgressList) {
      if (p.status === 'APPROVED' && p.task?.levelId && p.task?.id) {
        if (!approvedTasksByLevelId.has(p.task.levelId)) {
          approvedTasksByLevelId.set(p.task.levelId, new Set());
        }
        approvedTasksByLevelId.get(p.task.levelId)!.add(p.task.id);
      }
    }
    for (const s of userSubmissionsList) {
      if (s.status === 'APPROVED' && s.task?.levelId && s.task?.id) {
        if (!approvedTasksByLevelId.has(s.task.levelId)) {
          approvedTasksByLevelId.set(s.task.levelId, new Set());
        }
        approvedTasksByLevelId.get(s.task.levelId)!.add(s.task.id);
      }
    }

    const levelProgressByLevelId = new Map<string, any>();
    for (const lp of userLevelProgressList) {
      levelProgressByLevelId.set(lp.levelId, lp);
    }

    const levelStatsByNumber = new Map<number, { approvedCount: number; isCompleted: boolean }>();
    for (const lvl of allLevels) {
      const taskSet = approvedTasksByLevelId.get(lvl.id);
      const lp = levelProgressByLevelId.get(lvl.id);
      const approvedCount = Math.max(taskSet ? taskSet.size : 0, lp?.approvedTaskCount || 0);
      const isCompleted =
        lvl.levelNumber === 4
          ? approvedCount >= 1
          : approvedCount >= (lvl.requiredTaskCount || 10) || lp?.completionStatus === 'COMPLETED';
      levelStatsByNumber.set(lvl.levelNumber, { approvedCount, isCompleted });
    }

    const l1Completed = levelStatsByNumber.get(1)?.isCompleted || false;
    const l2Completed = l1Completed && (levelStatsByNumber.get(2)?.isCompleted || false);
    const l3Completed = l2Completed && (levelStatsByNumber.get(3)?.isCompleted || false);
    const l4Completed = l3Completed && (levelStatsByNumber.get(4)?.isCompleted || false);
    const isLevel4Unlocked = l3Completed && approvedLevelNumbers.has(4);

    const isLevel4Reached = Boolean(
      isLevel4Unlocked ||
      (levelStatsByNumber.get(4)?.approvedCount || 0) > 0 ||
      l4Completed
    );

    const hasWithdrawnLevel1 = userWithdrawalsList.length > 0;

    // Check if current level is unlocked
    // Levels 1-3: automatic progression (L1 -> L2 -> L3)
    // Levels 4-10: require previous level completed AND manual admin approval
    let isLevelUnlocked = false;
    if (levelNumber === 1) {
      isLevelUnlocked = true;
    } else if (levelNumber === 2) {
      isLevelUnlocked = l1Completed;
    } else if (levelNumber === 3) {
      isLevelUnlocked = l2Completed;
    } else if (levelNumber === 4) {
      isLevelUnlocked = l3Completed && approvedLevelNumbers.has(4);
    } else if (levelNumber === 5) {
      // Level 5 requires only one task completed in Level 4 AND admin approval
      isLevelUnlocked = l4Completed && approvedLevelNumbers.has(5);
    } else {
      const prevLvlCompleted = levelStatsByNumber.get(levelNumber - 1)?.isCompleted || false;
      isLevelUnlocked = prevLvlCompleted && approvedLevelNumbers.has(levelNumber);
    }

    // Determine prerequisite eligibility for Task 1 of this level
    let isTask1Eligible = false;
    let task1LockMessage = '';

    if (!isLevelUnlocked) {
      isTask1Eligible = false;
      if (levelNumber === 4 && l3Completed && !approvedLevelNumbers.has(4)) {
        task1LockMessage = 'Level 4 is locked. Please await administrator approval to unlock Level 4.';
      } else if (levelNumber === 5 && !l4Completed) {
        task1LockMessage = 'Complete any one task in Level 4 to unlock Level 5 tasks.';
      } else if (levelNumber >= 5 && (levelStatsByNumber.get(levelNumber - 1)?.isCompleted || false) && !approvedLevelNumbers.has(levelNumber)) {
        task1LockMessage = `Level ${levelNumber} is locked. Please await administrator approval to unlock Level ${levelNumber}.`;
      } else {
        task1LockMessage = `Level ${levelNumber} is locked. Complete all tasks in Level ${levelNumber - 1} first.`;
      }
    } else if (levelNumber === 1) {
      isTask1Eligible = true;
    } else if (levelNumber === 2) {
      isTask1Eligible = l1Completed;
      if (!isTask1Eligible) {
        task1LockMessage = 'Complete all tasks in Level 1 first to unlock Level 2 tasks.';
      }
    } else if (levelNumber === 3) {
      isTask1Eligible = l2Completed;
      if (!isTask1Eligible) {
        task1LockMessage = 'Complete all tasks in Level 2 first to unlock Level 3 tasks.';
      }
    } else if (levelNumber === 4) {
      isTask1Eligible = l3Completed && approvedLevelNumbers.has(4);
      if (!isTask1Eligible) {
        task1LockMessage = l3Completed
          ? 'Level 4 requires administrator approval to unlock.'
          : 'Complete all tasks in Level 3 first to unlock Level 4 tasks.';
      }
    } else if (levelNumber === 5) {
      // In Level 4, client needs 1 task completed AND admin approval to unlock Level 5 task participation!
      isTask1Eligible = l4Completed && approvedLevelNumbers.has(5);
      if (!isTask1Eligible) {
        task1LockMessage = l4Completed
          ? 'Level 5 requires administrator approval to unlock.'
          : 'Complete at least one Level 4 prepaid task to unlock Level 5 task participation.';
      }
    } else {
      // For Levels 6 to 10: requires previous level completed AND admin approval
      const prevStats = levelStatsByNumber.get(levelNumber - 1);
      isTask1Eligible = (prevStats?.isCompleted || false) && approvedLevelNumbers.has(levelNumber);
      if (!isTask1Eligible) {
        task1LockMessage = (prevStats?.isCompleted || false)
          ? `Level ${levelNumber} requires administrator approval to unlock.`
          : `Complete all tasks in Level ${levelNumber - 1} first to start Level ${levelNumber} tasks.`;
      }
    }

    // If level itself is locked:
    // When a user has reached Level 4 (or for levels 4 to 10), show task details, prizes, and descriptions!
    // Only mask details for Levels 1 to 3 if not yet reached.
    if (!isLevelUnlocked) {
      const hideDetails = levelNumber <= 3 ? !isLevelUnlocked : !isLevel4Reached;
      const prevLvlDone = levelStatsByNumber.get(level.levelNumber - 1)?.isCompleted || false;
      const lockedTasks: EvaluatedTask[] = level.tasks.map((task) => {
        const isPrepaidTask = Boolean(
          task.isPaid ||
          (task.unlockFee && task.unlockFee > 0) ||
          task.taskType?.toLowerCase().includes('prepaid')
        );
        return {
          id: task.id,
          levelId: task.levelId,
          taskNumber: task.taskNumber,
          title: hideDetails ? `Locked Task #${task.taskNumber}` : task.title,
          description: hideDetails
            ? (level.levelNumber >= 4 && prevLvlDone && !approvedLevelNumbers.has(level.levelNumber)
                ? `Level ${level.levelNumber} requires administrator approval to unlock and view task details.`
                : `Complete Level ${level.levelNumber - 1} to unlock this level and view task details.`)
            : task.description,
          taskType: hideDetails ? 'Locked' : (task.taskType || (isPrepaidTask ? 'Prepaid Task' : 'Task')),
          rewardAmount: hideDetails ? 0 : task.rewardAmount,
          creditPoints: 0,
          isPaid: hideDetails ? false : Boolean(task.isPaid),
          unlockFee: hideDetails ? 0 : (task.unlockFee || 0),
          requiresAdminApproval: task.requiresAdminApproval,
          status: task.status,
          userStatus: 'LOCKED',
          isPaidUnlocked: false,
          lockMessage:
            level.levelNumber >= 4 && prevLvlDone && !approvedLevelNumbers.has(level.levelNumber)
              ? `Level ${level.levelNumber} is locked. Please await administrator approval to unlock Level ${level.levelNumber}.`
              : `Level ${level.levelNumber} is locked. Complete all tasks in Level ${level.levelNumber - 1} first to submit this task.`,
          instructions: hideDetails ? null : task.instructions,
          protectedUrl: null,
          submissionInstructions: hideDetails ? null : task.submissionInstructions,
          externalContact: null,
          submission: null,
        };
      });

      return {
        level,
        tasks: lockedTasks,
        isLevelUnlocked: false,
        isLevel4Reached,
      };
    }

    // Level is unlocked! Map user progress and submissions
    const progressMap = new Map(currentLevelProgressRecords.map((p) => [p.taskId, p]));
    const submissionMap = new Map<string, any>();
    for (const s of currentLevelSubmissions) {
      if (!submissionMap.has(s.taskId)) {
        submissionMap.set(s.taskId, s);
      }
    }

    const evaluatedTasks: EvaluatedTask[] = [];
    let previousTaskApproved: boolean = isTask1Eligible;

    // In Level 4: Only ONE task can be completed per user.
    // Detect if user has any approved or pending task in Level 4:
    const l4ApprovedTask = level.levelNumber === 4
      ? level.tasks.find((t) => {
          const p = progressMap.get(t.id);
          const s = submissionMap.get(t.id);
          return p?.status === 'APPROVED' || s?.status === 'APPROVED';
        })
      : null;

    const l4PendingTask = level.levelNumber === 4
      ? level.tasks.find((t) => {
          const p = progressMap.get(t.id);
          const s = submissionMap.get(t.id);
          return (
            (s?.status === 'PENDING' || p?.status === 'PENDING_VERIFICATION') &&
            p?.status !== 'APPROVED' &&
            s?.status !== 'APPROVED'
          );
        })
      : null;

    for (const task of level.tasks) {
      const progress = progressMap.get(task.id);
      const submission = submissionMap.get(task.id);

      let userStatus: EvaluatedTask['userStatus'] = 'LOCKED';
      let isPaidUnlocked = progress?.isPaidUnlocked || false;

      // A task is approved if UserTaskProgress is APPROVED or TaskSubmission is APPROVED
      const isApproved = progress?.status === 'APPROVED' || submission?.status === 'APPROVED';

      // Check whether prerequisite task is satisfied:
      // For Task 1: must satisfy isTask1Eligible
      // For Task > 1: previous task (taskNumber - 1) in THIS level must be APPROVED
      let isPrerequisiteSatisfied = false;
      let taskLockMessage = '';

      if (level.levelNumber === 4) {
        if (l4ApprovedTask) {
          if (task.id === l4ApprovedTask.id) {
            userStatus = 'APPROVED';
            isPrerequisiteSatisfied = true;
          } else {
            // Only one task can be completed in Level 4. The other 9 tasks are locked and closed.
            userStatus = 'LOCKED';
            isPrerequisiteSatisfied = false;
            taskLockMessage = 'Level 4 allows only one task to be completed. You have already completed your Level 4 task. Please proceed to Level 5!';
          }
        } else if (l4PendingTask) {
          if (task.id === l4PendingTask.id) {
            userStatus = 'PENDING_VERIFICATION';
            isPrerequisiteSatisfied = true;
          } else {
            userStatus = 'LOCKED';
            isPrerequisiteSatisfied = false;
            taskLockMessage = 'You have already submitted a Level 4 task awaiting approval. Only one task can be completed in Level 4.';
          }
        } else {
          // No task completed or pending in Level 4 yet:
          // All 10 tasks are selectable options
          isPrerequisiteSatisfied = isTask1Eligible;
          if (!isPrerequisiteSatisfied) {
            taskLockMessage = task1LockMessage;
          }
          if (task.status === 'DISABLED') {
            userStatus = 'DISABLED';
          } else if (isApproved) {
            userStatus = 'APPROVED';
          } else if (submission?.status === 'PENDING' || progress?.status === 'PENDING_VERIFICATION') {
            userStatus = 'PENDING_VERIFICATION';
          } else if (progress?.status === 'REJECTED' || submission?.status === 'REJECTED') {
            userStatus = 'REJECTED';
          } else if (isPrerequisiteSatisfied) {
            userStatus = 'AVAILABLE';
            if (task.isPaid && isPaidUnlocked) {
              isPaidUnlocked = true;
            }
          } else {
            userStatus = 'LOCKED';
          }
        }
      } else if (task.taskNumber === 1) {
        isPrerequisiteSatisfied = isTask1Eligible;
        if (!isPrerequisiteSatisfied) {
          taskLockMessage = task1LockMessage;
        }
        if (task.status === 'DISABLED') {
          userStatus = 'DISABLED';
        } else if (isApproved) {
          userStatus = 'APPROVED';
        } else if (submission?.status === 'PENDING' || progress?.status === 'PENDING_VERIFICATION') {
          userStatus = 'PENDING_VERIFICATION';
        } else if (progress?.status === 'REJECTED' || submission?.status === 'REJECTED') {
          userStatus = 'REJECTED';
        } else if (isPrerequisiteSatisfied) {
          userStatus = 'AVAILABLE';
          if (task.isPaid && isPaidUnlocked) {
            isPaidUnlocked = true;
          }
        } else {
          userStatus = 'LOCKED';
        }
      } else {
        const prevTask = level.tasks.find((t) => t.taskNumber === task.taskNumber - 1);
        const prevProgress = prevTask ? progressMap.get(prevTask.id) : null;
        const prevSubmission = prevTask ? submissionMap.get(prevTask.id) : null;
        const isPrevApproved =
          prevProgress?.status === 'APPROVED' ||
          prevSubmission?.status === 'APPROVED' ||
          previousTaskApproved;

        isPrerequisiteSatisfied = isPrevApproved;
        if (!isPrerequisiteSatisfied) {
          taskLockMessage = `Task #${task.taskNumber} is locked. Complete Task #${task.taskNumber - 1} first in proper sequence.`;
        }
        if (task.status === 'DISABLED') {
          userStatus = 'DISABLED';
        } else if (isApproved) {
          userStatus = 'APPROVED';
        } else if (submission?.status === 'PENDING' || progress?.status === 'PENDING_VERIFICATION') {
          userStatus = 'PENDING_VERIFICATION';
        } else if (progress?.status === 'REJECTED' || submission?.status === 'REJECTED') {
          userStatus = 'REJECTED';
        } else if (isPrerequisiteSatisfied) {
          userStatus = 'AVAILABLE';
          if (task.isPaid && isPaidUnlocked) {
            isPaidUnlocked = true;
          }
        } else {
          userStatus = 'LOCKED';
        }
      }

      // Track approved status for next sequential task
      previousTaskApproved = isApproved;

      // Sensitive operational links only accessible when active/approved
      const hasAccessToProtectedContent = ['UNLOCKED', 'AVAILABLE', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'APPROVED', 'REJECTED', 'AWAITING_PAYMENT'].includes(userStatus);
      const isLocked = userStatus === 'LOCKED';

      // In Levels 1 to 3: if a task is locked (user hasn't reached it yet), mask its title, prize, and prepaid fee!
      // Once user reaches Level 4 (Levels 4 to 10), all tasks and their prices/rewards are visible.
      const hideLockedTaskInL1ToL3 = isLocked && level.levelNumber <= 3;

      const isPrepaidTask = Boolean(
        task.isPaid ||
        (task.unlockFee && task.unlockFee > 0) ||
        task.taskType?.toLowerCase().includes('prepaid')
      );

      evaluatedTasks.push({
        id: task.id,
        levelId: task.levelId,
        taskNumber: task.taskNumber,
        title: hideLockedTaskInL1ToL3 ? `Locked Task #${task.taskNumber}` : task.title,
        description: hideLockedTaskInL1ToL3
          ? `Complete Task #${task.taskNumber - 1} first to unlock this task and view its reward.`
          : task.description,
        taskType: hideLockedTaskInL1ToL3 ? 'Locked' : (task.taskType || (isPrepaidTask ? 'Prepaid Task' : 'Task')),
        rewardAmount: hideLockedTaskInL1ToL3 ? 0 : task.rewardAmount,
        creditPoints: 0,
        isPaid: hideLockedTaskInL1ToL3 ? false : Boolean(task.isPaid),
        unlockFee: hideLockedTaskInL1ToL3 ? 0 : (task.unlockFee || 0),
        requiresAdminApproval: task.requiresAdminApproval,
        status: task.status,
        userStatus,
        isPaidUnlocked,
        lockMessage: isLocked ? (taskLockMessage || task.lockMessage || `Task #${task.taskNumber} is locked. Complete Task #${task.taskNumber - 1} first in proper sequence.`) : '',
        instructions: hasAccessToProtectedContent && !isLocked ? task.instructions : null,
        protectedUrl: hasAccessToProtectedContent && !isLocked ? task.protectedUrl : null,
        submissionInstructions: hasAccessToProtectedContent && !isLocked ? task.submissionInstructions : null,
        externalContact: hasAccessToProtectedContent && !isLocked ? task.externalContact : null,
        submission: submission || null,
      });
    }

    return {
      level,
      tasks: evaluatedTasks,
      isLevelUnlocked,
      isLevel4Reached,
    };
  },

  /**
   * Recalculates and updates level progression for a user
   */
  async updateLevelProgress(userId: string, levelId: string) {
    const level = await prisma.level.findUnique({
      where: { id: levelId },
      include: { tasks: true },
    });
    if (!level) return null;

    const [userProgressCount, submissionsCount, userLevelProgress] = await Promise.all([
      prisma.userTaskProgress.count({
        where: {
          userId,
          task: { levelId },
          status: 'APPROVED',
        },
      }),
      prisma.taskSubmission.count({
        where: {
          userId,
          task: { levelId },
          status: 'APPROVED',
        },
      }),
      prisma.userLevelProgress.findUnique({
        where: { userId_levelId: { userId, levelId } },
      }),
    ]);

    const approvedCount = Math.max(
      userProgressCount,
      submissionsCount,
      userLevelProgress?.approvedTaskCount || 0
    );

    const isCompleted =
      level.levelNumber === 4
        ? approvedCount >= 1
        : approvedCount >= (level.requiredTaskCount || 10);

    const progress = await prisma.userLevelProgress.upsert({
      where: {
        userId_levelId: { userId, levelId },
      },
      update: {
        approvedTaskCount: approvedCount,
        completionStatus: isCompleted ? 'COMPLETED' : 'IN_PROGRESS',
        completedAt: isCompleted ? new Date() : undefined,
      },
      create: {
        userId,
        levelId,
        approvedTaskCount: approvedCount,
        completionStatus: isCompleted ? 'COMPLETED' : 'IN_PROGRESS',
        completedAt: isCompleted ? new Date() : null,
      },
    });

    // Note: There are no level completion rewards; rewards are strictly per-task only.

    // If referee completed Level 1, evaluate referral qualification
    if (isCompleted && level.levelNumber === 1) {
      await affiliateService.checkAndQualifyReferral(userId, 'LEVEL_1_COMPLETED');
    }

    // Award 1 Free Spin entitlement upon completing the 10th task (level completion)
    if (isCompleted) {
      const existingLevelSpin = await prisma.userSpinEntitlement.findFirst({
        where: {
          userId,
          levelNumber: level.levelNumber,
        },
      });

      if (!existingLevelSpin) {
        await prisma.userSpinEntitlement.create({
          data: {
            userId,
            levelNumber: level.levelNumber,
            taskNumber: level.requiredTaskCount || 10,
            triggerReason: `Level ${level.levelNumber} Completion Free Spin`,
            totalSpins: 1,
            remainingSpins: 1,
            isEligible: false,
            requiresAdminReview: true,
            adminReviewed: false,
            assignedPrizeId: null,
          },
        });

        await prisma.notification.create({
          data: {
            userId,
            title: `Level ${level.levelNumber} Completed! Free Spin Earned! 🎡`,
            message: `Congratulations! Completing Level ${level.levelNumber} earned you a Free Royal Spin! Your entitlement has been submitted to administration.`,
            notificationType: 'SPIN_REWARD',
          },
        });
      }
    }

    return progress;
  },
};
