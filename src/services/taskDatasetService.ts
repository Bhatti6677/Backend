import { prisma } from '../prisma';
import { DATASET_10_LEVELS, cleanUrl } from '../../prisma/dataset10Levels';

let datasetSynced = false;

/**
 * Synchronizes the 10-level dataset into PostgreSQL/Supabase.
 * Enforces:
 * - Level 1: 10 free tasks (Rs 15 each). All 10 required to unlock Level 2.
 * - Level 2: Tasks 1-9 free (Rs 40 each), Task 10 prepaid (Rs 1,360, 40% commission = Rs 544). All 10 required to unlock Level 3.
 * - Level 3: Tasks 1-8 free (Rs 60 each), Task 9 prepaid (Rs 6,257, 40% = Rs 2,503), Task 10 prepaid (Rs 14,260, 40% = Rs 5,704). All 10 required to finish Level 3.
 * - Level 4: 10 prepaid tasks (Rs 30k to 170k, 40% commission). All 10 visible and selectable. Completing 1 task unlocks Level 5.
 * - Levels 5 to 10: 10 free tasks each with no prepaid charges. All tasks visible. Unspecified rewards (no invented numbers).
 */
export async function syncDatasetTasksToDatabase(): Promise<void> {
  if (datasetSynced) return;

  try {
    const existingCount = await prisma.task.count();
    if (existingCount >= 100) {
      datasetSynced = true;
      return;
    }

    for (const lvlData of DATASET_10_LEVELS) {
      const levelNumber = lvlData.level;
      const title = lvlData.title;
      const requiredTaskCount = lvlData.total_tasks;
      const completionReward = 0;
      const totalCreditPoints = 0;

      const level = await prisma.level.upsert({
        where: { levelNumber },
        update: {
          title,
          requiredTaskCount,
          completionReward,
          totalCreditPoints,
          displayOrder: levelNumber,
          status: 'ACTIVE',
        },
        create: {
          levelNumber,
          title,
          description: `Complete tasks in Level ${levelNumber} (${title}) to earn verified task rewards and advance to the next level.`,
          requiredTaskCount,
          completionReward,
          totalCreditPoints,
          displayOrder: levelNumber,
          status: 'ACTIVE',
        },
      });

      for (const t of lvlData.tasks) {
        const taskNumber = t.task_id;
        const type = t.type;
        const commission = t.commission;
        const creditPoints = 0;
        const isPaid = t.is_prepaid;
        const unlockFee = t.prepaid_value || 0;
        const pureUrl = cleanUrl(t.url);

        const taskTitle = isPaid
          ? `${type} (PKR ${unlockFee.toLocaleString()})`
          : `YouTube ${type}`;

        const description = isPaid
          ? `Prepaid task requiring deposit unlock fee of PKR ${unlockFee.toLocaleString()}. Yields commission of PKR ${commission.toLocaleString()} upon completion.`
          : `Complete the ${type} action on YouTube. Watch, engage, and submit confirmation proof for admin verification to earn PKR ${commission}.`;

        const instructions = isPaid
          ? `1. Ensure wallet has sufficient balance or deposit PKR ${unlockFee.toLocaleString()}.\n2. Click Unlock Task to pay fee.\n3. Open protected link: ${pureUrl}\n4. Complete engagement steps.\n5. Submit transaction and proof screenshot for admin approval.`
          : `1. Open link: ${pureUrl}\n2. Perform ${type} action.\n3. Take a screenshot showing proof of action.\n4. Submit reference and proof for instant admin verification.`;

        const lockMessage =
          taskNumber === 1
            ? levelNumber === 1
              ? 'Available to start'
              : `Complete and receive approval for all tasks in Level ${levelNumber - 1} to unlock Level ${levelNumber}.`
            : `Complete and receive approval for Task ${taskNumber - 1} to unlock this task.`;

        await prisma.task.upsert({
          where: {
            levelId_taskNumber: {
              levelId: level.id,
              taskNumber,
            },
          },
          update: {
            title: taskTitle,
            description,
            taskType: type,
            rewardAmount: commission,
            creditPoints,
            isPaid,
            unlockFee,
            protectedUrl: pureUrl,
            instructions,
            lockMessage,
            submissionInstructions: 'Submit proof reference or transaction details for verification.',
            requiresAdminApproval: true,
            status: 'ACTIVE',
          },
          create: {
            levelId: level.id,
            taskNumber,
            title: taskTitle,
            description,
            taskType: type,
            rewardAmount: commission,
            creditPoints,
            isPaid,
            unlockFee,
            protectedUrl: pureUrl,
            instructions,
            lockMessage,
            submissionInstructions: 'Submit proof reference or transaction details for verification.',
            requiresAdminApproval: true,
            status: 'ACTIVE',
          },
        });
      }
    }

    datasetSynced = true;
    console.log('✅ Synchronized 10 Levels & tasks: Level 1 (Rs 10, all free), Level 2 (task 10 paid), Levels 5-10 (all free).');
  } catch (err) {
    console.error('Failed to sync dataset tasks to database:', err);
  }
}
