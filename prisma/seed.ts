import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DATASET_10_LEVELS, cleanUrl } from './dataset10Levels';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting Royal Rewards database seed...');

  // 1. Site Settings
  const settings = [
    { key: 'site_name', value: 'Earn Sheet', category: 'GENERAL', description: 'Public platform brand name' },
    { key: 'support_email', value: 'support@earnsheet.com', category: 'GENERAL', description: 'Official support email' },
    { key: 'support_whatsapp', value: '+92 300 1234567', category: 'GENERAL', description: 'Official verification and support line' },
    { key: 'welcome_message', value: 'Welcome to Earn Sheet! Complete tasks, earn verified rewards, and spin the royal wheel!', category: 'BRANDING', description: 'User dashboard greeting banner' },
    { key: 'default_submission_instructions', value: 'Complete the required task steps. Send proof or screenshot to the official verification channel and submit your confirmation reference below.', category: 'TASKS', description: 'Default submission guidance' },
    { key: 'currency', value: 'PKR', category: 'FINANCE', description: 'Platform base currency' },
    { key: 'min_deposit', value: '500', category: 'FINANCE', description: 'Minimum allowed deposit in PKR' },
    { key: 'support_telegram', value: 'https://t.me/earnsheet_official', category: 'GENERAL', description: 'Official Telegram support line' },
    { key: 'easypaisa_title', value: 'Earn Sheet Official', category: 'FINANCE', description: 'Receiving Easypaisa title' },
    { key: 'easypaisa_number', value: '0312-3456789', category: 'FINANCE', description: 'Receiving Easypaisa account number' },
    { key: 'jazzcash_title', value: 'Earn Sheet Official', category: 'FINANCE', description: 'Receiving JazzCash title' },
    { key: 'jazzcash_number', value: '0301-9876543', category: 'FINANCE', description: 'Receiving JazzCash account number' },
    { key: 'bank_name', value: 'Meezan Bank Limited', category: 'FINANCE', description: 'Receiving Bank name' },
    { key: 'bank_title', value: 'Earn Sheet Enterprise PVT', category: 'FINANCE', description: 'Receiving Bank account title' },
    { key: 'bank_account', value: '01020304050607', category: 'FINANCE', description: 'Receiving Bank account number' },
    { key: 'bank_iban', value: 'PK12MEZN0001020304050607', category: 'FINANCE', description: 'Receiving Bank IBAN' },
    { key: 'referral_reward', value: '250', category: 'REFERRAL', description: 'Reward per qualifying referral in PKR' },
    { key: 'referral_level1_required', value: 'true', category: 'REFERRAL', description: 'Whether referee must complete Level 1 to qualify' },
    { key: 'spin_enabled', value: 'true', category: 'SPIN', description: 'Global spin wheel feature toggle' },
    { key: 'spin_cooldown_hours', value: '24', category: 'SPIN', description: 'Cooldown between spins in hours' },
  ];

  for (const s of settings) {
    await prisma.siteSetting.upsert({
      where: { key: s.key },
      update: { value: s.value, category: s.category, description: s.description },
      create: s,
    });
  }
  console.log(`✅ Seeded ${settings.length} site settings`);

  // 2. Admin User
  const adminPasswordHash = await bcrypt.hash('Admin@Royal2026!', 10);
  const admin = await prisma.adminUser.upsert({
    where: { username: 'admin' },
    update: { passwordHash: adminPasswordHash, role: 'SUPER_ADMIN', status: 'ACTIVE' },
    create: {
      username: 'admin',
      passwordHash: adminPasswordHash,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  });
  console.log(`✅ Seeded Admin User: ${admin.username} (Password: Admin@Royal2026!)`);

  // 3. Spin Prizes (8 Official Prizes)
  const spinPrizesData = [
    { name: 'PKR 50', prizeType: 'CASH', monetaryValue: 50, displayLabel: 'PKR 50', color: '#1459E8', icon: 'Coins' },
    { name: 'PKR 100', prizeType: 'CASH', monetaryValue: 100, displayLabel: 'PKR 100', color: '#792BFF', icon: 'Gift' },
    { name: 'Suzuki Alto Car', prizeType: 'PHYSICAL', monetaryValue: 2500000, displayLabel: 'Alto Car', color: '#059669', icon: 'Car' },
    { name: 'PKR 3,000', prizeType: 'CASH', monetaryValue: 3000, displayLabel: 'PKR 3,000', color: '#DC2626', icon: 'Crown' },
    { name: 'PKR 1,000', prizeType: 'CASH', monetaryValue: 1000, displayLabel: 'PKR 1,000', color: '#0284C7', icon: 'Sparkles' },
    { name: 'PKR 5,000', prizeType: 'CASH', monetaryValue: 5000, displayLabel: 'PKR 5,000 Mega', color: '#D97706', icon: 'Trophy' },
    { name: 'Expensive Watch', prizeType: 'PHYSICAL', monetaryValue: 45000, displayLabel: 'Expensive Watch', color: '#4F46E5', icon: 'Watch' },
    { name: 'iPhone 15 Pro', prizeType: 'PHYSICAL', monetaryValue: 350000, displayLabel: 'iPhone 15 Pro', color: '#EAB308', icon: 'Smartphone' },
  ];

  await prisma.spinPrize.deleteMany({});
  const createdPrizes = [];
  for (const p of spinPrizesData) {
    const created = await prisma.spinPrize.create({ data: p });
    createdPrizes.push(created);
  }
  console.log(`✅ Seeded ${createdPrizes.length} Spin Prizes`);

  // 3.5. Ensure 100 Official Admin Referral Codes
  const { ensureAdminReferralCodes } = await import('../src/services/adminReferralService');
  await ensureAdminReferralCodes();
  console.log('✅ Ensured 100 official Admin Referral Codes');

  // 4. Exactly 10 Levels & 135 Tasks (from official 10-tier dataset)
  const levels = [];
  let totalTasksCount = 0;

  for (const lvlData of DATASET_10_LEVELS) {
    const levelNumber = lvlData.level;
    const title = lvlData.title;
    const requiredTaskCount = lvlData.total_tasks;
    const completionReward = lvlData.level_reward;
    const totalCreditPoints = 0;

    const level = await prisma.level.upsert({
      where: { levelNumber },
      update: {
        title,
        description: `Complete all ${requiredTaskCount} tasks in Level ${levelNumber} (${title}) to claim the PKR ${completionReward.toLocaleString()} milestone reward.`,
        requiredTaskCount,
        completionReward,
        totalCreditPoints,
        displayOrder: levelNumber,
        status: 'ACTIVE',
      },
      create: {
        levelNumber,
        title,
        description: `Complete all ${requiredTaskCount} tasks in Level ${levelNumber} (${title}) to claim the PKR ${completionReward.toLocaleString()} milestone reward.`,
        requiredTaskCount,
        completionReward,
        totalCreditPoints,
        displayOrder: levelNumber,
        status: 'ACTIVE',
      },
    });
    levels.push(level);

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

      const lockMessage = taskNumber === 1
        ? (levelNumber === 1 ? 'Available to start' : `Complete and receive approval for all tasks in Level ${levelNumber - 1} to unlock Level ${levelNumber}.`)
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

      totalTasksCount++;
    }
  }
  console.log(`✅ Seeded 10 Levels and ${totalTasksCount} Tasks with complete dataset`);

  // 5. Demo Test User
  const demoUserPassword = await bcrypt.hash('Password123!', 10);
  const demoUser = await prisma.user.upsert({
    where: { phone: '03001234567' },
    update: {
      name: 'Shahid Khan',
      passwordHash: demoUserPassword,
      referralCode: 'ROYAL777',
      accountStatus: 'ACTIVE',
    },
    create: {
      name: 'Shahid Khan',
      phone: '03001234567',
      passwordHash: demoUserPassword,
      referralCode: 'ROYAL777',
      accountStatus: 'ACTIVE',
    },
  });

  // Wallet for Demo User with balance and 100 initial credit points
  const wallet = await prisma.wallet.upsert({
    where: { userId: demoUser.id },
    update: {
      availableBalance: 6500,
      totalEarned: 1500,
      totalDeposited: 5000,
      creditPoints: 100,
    },
    create: {
      userId: demoUser.id,
      availableBalance: 6500,
      totalEarned: 1500,
      totalDeposited: 5000,
      creditPoints: 100,
    },
  });

  // Level 1 Progress for Demo User
  const level1 = levels[0];
  await prisma.userLevelProgress.upsert({
    where: { userId_levelId: { userId: demoUser.id, levelId: level1.id } },
    update: { completionStatus: 'IN_PROGRESS', approvedTaskCount: 8 },
    create: { userId: demoUser.id, levelId: level1.id, completionStatus: 'IN_PROGRESS', approvedTaskCount: 8 },
  });

  // Initialize all Level 1 tasks for demo user:
  // Tasks 1 to 8: APPROVED
  // Task 9: AWAITING_PAYMENT (paid task with PKR 5000 unlock fee)
  // Task 10: LOCKED
  const level1Tasks = await prisma.task.findMany({
    where: { levelId: level1.id },
    orderBy: { taskNumber: 'asc' },
  });

  for (const task of level1Tasks) {
    if (task.taskNumber <= 8) {
      await prisma.userTaskProgress.upsert({
        where: { userId_taskId: { userId: demoUser.id, taskId: task.id } },
        update: { status: 'APPROVED', approvedAt: new Date() },
        create: { userId: demoUser.id, taskId: task.id, status: 'APPROVED', approvedAt: new Date() },
      });
    } else if (task.taskNumber === 9) {
      await prisma.userTaskProgress.upsert({
        where: { userId_taskId: { userId: demoUser.id, taskId: task.id } },
        update: { status: 'AWAITING_PAYMENT' },
        create: { userId: demoUser.id, taskId: task.id, status: 'AWAITING_PAYMENT' },
      });
    } else {
      await prisma.userTaskProgress.upsert({
        where: { userId_taskId: { userId: demoUser.id, taskId: task.id } },
        update: { status: 'LOCKED' },
        create: { userId: demoUser.id, taskId: task.id, status: 'LOCKED' },
      });
    }
  }

  // Spin entitlement for demo user assigned with a specific prize (PKR 500)
  const prize500 = createdPrizes.find((p) => p.monetaryValue === 500) || createdPrizes[0];
  await prisma.userSpinEntitlement.deleteMany({ where: { userId: demoUser.id } });
  await prisma.userSpinEntitlement.create({
    data: {
      userId: demoUser.id,
      assignedPrizeId: prize500.id,
      totalSpins: 1,
      remainingSpins: 1,
      isEligible: true,
    },
  });

  // Seed sample transactions for Shahid Khan
  await prisma.walletTransaction.deleteMany({ where: { userId: demoUser.id } });
  await prisma.walletTransaction.createMany({
    data: [
      {
        userId: demoUser.id,
        transactionType: 'DEPOSIT_CREDIT',
        amount: 5000,
        currency: 'PKR',
        status: 'COMPLETED',
        reason: 'Deposit Approved via Easypaisa',
        notes: 'Ref: EP-9876543210',
        actorName: 'admin',
      },
      {
        userId: demoUser.id,
        transactionType: 'TASK_REWARD',
        amount: 850,
        currency: 'PKR',
        status: 'COMPLETED',
        reason: 'Level 1 Tasks 1-8 Approved Rewards',
        actorName: 'admin',
      },
      {
        userId: demoUser.id,
        transactionType: 'REFERRAL_REWARD',
        amount: 650,
        currency: 'PKR',
        status: 'COMPLETED',
        reason: 'Referral Bonus for invited members',
        actorName: 'system',
      },
    ],
  });

  // Seed sample pending deposit request for admin panel demonstration
  await prisma.depositRequest.create({
    data: {
      userId: demoUser.id,
      amount: 2500,
      paymentMethod: 'JAZZCASH',
      transactionReference: 'JC-4421098551',
      proofEvidence: 'Proof screenshot sent to verification WhatsApp',
      status: 'PENDING',
    },
  });

  // Seed sample withdrawal request for admin panel demonstration
  await prisma.withdrawalRequest.create({
    data: {
      userId: demoUser.id,
      amount: 1500,
      paymentMethod: 'EASYPAISA',
      recipientName: 'Shahid Khan',
      recipientAccount: '0300-1234567',
      notes: 'Weekly withdrawal request',
      approvalStatus: 'PENDING',
      paymentStatus: 'NOT_SENT',
    },
  });

  // Seed sample notification
  await prisma.notification.createMany({
    data: [
      {
        userId: demoUser.id,
        title: 'Welcome to Earn Sheet! 👑',
        message: 'Your account is active. Start with Level 1 tasks to earn your first rewards.',
        notificationType: 'REGISTRATION',
      },
      {
        userId: demoUser.id,
        title: 'Deposit Approved: PKR 5,000',
        message: 'Your Easypaisa deposit of PKR 5,000 has been verified and added to your wallet.',
        notificationType: 'DEPOSIT_STATUS',
      },
      {
        userId: demoUser.id,
        title: 'Royal Spin Available! 🎡',
        message: 'You have 1 royal spin waiting. Spin now for exclusive cash prizes!',
        notificationType: 'SPIN_REWARD',
      },
    ],
  });

  // Seed announcement
  await prisma.announcement.create({
    data: {
      title: 'Earn Sheet Grand Launch & VIP Task Multipliers',
      content: 'Welcome to Earn Sheet! Enjoy instant verification on all tasks this week and 2x referral bonuses.',
      audience: 'ALL',
      status: 'ACTIVE',
    },
  });

  console.log(`✅ Seeded Demo User (Phone: 03001234567, Pass: Password123!) with wallet, tasks, spin entitlement, and transactions`);
  console.log('🎉 Seeding successfully completed!');
}

main()
  .catch((e) => {
    console.error('❌ Error during database seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
