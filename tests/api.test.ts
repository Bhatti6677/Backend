import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/prisma';
import { getAdminReferralCodesOverview } from '../src/services/adminReferralService';

const app = createApp();

describe('Royal Rewards Full-Stack API Suite', { timeout: 30000 }, () => {
  let userToken = '';
  let userId = '';
  let adminToken = '';
  let validRefCode = 'ROYAL777';
  const testPhone = `0311${Math.floor(1000000 + Math.random() * 9000000)}`;

  beforeAll(async () => {
    // Authenticate as seeded admin
    const adminRes = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: 'Admin@Royal2026!' });
    expect(adminRes.status).toBe(200);
    adminToken = adminRes.body.token;

    // Find an available admin referral code
    const overview = await getAdminReferralCodesOverview();
    if (overview.availableCodes.length > 0) {
      validRefCode = overview.availableCodes[0].code;
    }
  }, 30000);

  describe('1. Authentication and User Registration', () => {
    it('registers a new user successfully with wallet and Level 1 progress', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Royal Tester',
          phone: testPhone,
          password: 'TestPassword123!',
          confirmPassword: 'TestPassword123!',
          referralCode: validRefCode,
        });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.phone).toBe(testPhone);
      userToken = res.body.token;
      userId = res.body.user.id;

      // Verify wallet was created with 0 balance
      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      expect(wallet).not.toBeNull();
      expect(wallet?.availableBalance).toBe(0);

      // Verify Level 1 progress was initialized
      const levelProgress = await prisma.userLevelProgress.findFirst({
        where: { userId },
      });
      expect(levelProgress).not.toBeNull();
      expect(levelProgress?.completionStatus).toBe('IN_PROGRESS');
    });

    it('rejects duplicate phone number registration', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Duplicate Tester',
          phone: testPhone,
          password: 'TestPassword123!',
          confirmPassword: 'TestPassword123!',
          referralCode: validRefCode,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('already registered');
    });

    it('rejects registration when passwords do not match', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Mismatch Tester',
          phone: '03229999999',
          password: 'Password123!',
          confirmPassword: 'DifferentPassword!',
          referralCode: validRefCode,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('logs in successfully and returns JWT token', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          phone: testPhone,
          password: 'TestPassword123!',
        });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.id).toBe(userId);
    });

    it('rejects login with invalid password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          phone: testPhone,
          password: 'WrongPassword!',
        });

      expect(res.status).toBe(401);
    });
  });

  describe('2. Task Progression & Sequential Prerequisites', () => {
    it('confirms exactly 10 levels exist in the database', async () => {
      const count = await prisma.level.count();
      expect(count).toBe(10);
    });

    it('confirms Level 1 has exactly 10 tasks and Task 1 is AVAILABLE for new user', async () => {
      const res = await request(app)
        .get('/api/tasks/levels/1')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.tasks.length).toBe(10);
      expect(res.body.tasks[0].taskNumber).toBe(1);
      expect(res.body.tasks[0].userStatus).toBe('AVAILABLE');
      expect(res.body.tasks[0].instructions).not.toBeNull();

      // Task 2 should be LOCKED because Task 1 is not approved yet
      expect(res.body.tasks[1].taskNumber).toBe(2);
      expect(res.body.tasks[1].userStatus).toBe('LOCKED');
      // Protected instructions & URL must be withheld!
      expect(res.body.tasks[1].instructions).toBeNull();
      expect(res.body.tasks[1].protectedUrl).toBeNull();
    });

    it('prevents user from submitting a locked task', async () => {
      const level1 = await prisma.level.findUnique({
        where: { levelNumber: 1 },
        include: { tasks: { orderBy: { taskNumber: 'asc' } } },
      });
      const task2 = level1!.tasks[1];

      const res = await request(app)
        .post(`/api/tasks/${task2.id}/submit`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ submissionNotes: 'Trying to bypass sequential lock' });

      expect(res.status).toBe(403);
    });

    it('allows submitting available Task 1', async () => {
      const level1 = await prisma.level.findUnique({
        where: { levelNumber: 1 },
        include: { tasks: { orderBy: { taskNumber: 'asc' } } },
      });
      const task1 = level1!.tasks[0];

      const res = await request(app)
        .post(`/api/tasks/${task1.id}/submit`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ submissionNotes: 'Task 1 completed successfully. Channel joined.' });

      expect(res.status).toBe(201);
      expect(res.body.userStatus).toBe('PENDING_VERIFICATION');

      // Verify submission appears in database
      const sub = await prisma.taskSubmission.findUnique({
        where: { id: res.body.submission.id },
      });
      expect(sub?.status).toBe('PENDING');
    });

    it('allows admin to approve Task 1 and credits reward once', async () => {
      const pendingSub = await prisma.taskSubmission.findFirst({
        where: { userId, status: 'PENDING' },
        include: { task: true },
      });
      expect(pendingSub).not.toBeNull();

      const res = await request(app)
        .put(`/api/admin/submissions/${pendingSub!.id}/review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'APPROVE', reviewNotes: 'Verified Telegram membership proof' });

      expect(res.status).toBe(200);

      // Verify wallet balance received the task reward
      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      expect(wallet?.availableBalance).toBe(pendingSub!.task.rewardAmount);

      // Verify Task 2 is now AVAILABLE!
      const levelRes = await request(app)
        .get('/api/tasks/levels/1')
        .set('Authorization', `Bearer ${userToken}`);
      expect(levelRes.body.tasks[1].userStatus).toBe('AVAILABLE');
    });
  });

  describe('3. Paid Task Unlocking & Balance Safety', () => {
    it('prevents paid task unlock with insufficient balance', async () => {
      // Find a prepaid VIP task (isPaid: true)
      const paidTask = await prisma.task.findFirst({
        where: { isPaid: true },
        include: { level: { include: { tasks: { orderBy: { taskNumber: 'asc' } } } } },
      });
      expect(paidTask).not.toBeNull();
      expect(paidTask!.isPaid).toBe(true);

      // Make sure prerequisite task is satisfied for this check
      const levelTasks = paidTask!.level.tasks;
      const prevTaskIndex = levelTasks.findIndex((t) => t.id === paidTask!.id) - 1;
      if (prevTaskIndex >= 0) {
        await prisma.userTaskProgress.upsert({
          where: { userId_taskId: { userId, taskId: levelTasks[prevTaskIndex].id } },
          update: { status: 'APPROVED' },
          create: { userId, taskId: levelTasks[prevTaskIndex].id, status: 'APPROVED' },
        });
      }

      const res = await request(app)
        .post(`/api/tasks/${paidTask!.id}/unlock`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Insufficient wallet balance');
    });

    it('unlocks paid task when user has sufficient balance', async () => {
      // Find a prepaid VIP task (isPaid: true)
      const paidTask = await prisma.task.findFirst({
        where: { isPaid: true },
      });

      // Admin credits PKR 50,000 to user wallet via balance adjustment
      const adjustRes = await request(app)
        .post(`/api/admin/users/${userId}/adjust-balance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 50000,
          actionType: 'CREDIT',
          reason: 'Test promotional credit for paid task unlocking',
        });
      expect(adjustRes.status).toBe(200);

      const unlockRes = await request(app)
        .post(`/api/tasks/${paidTask!.id}/unlock`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(unlockRes.status).toBe(200);
      expect(unlockRes.body.task.userStatus).toBe('UNLOCKED');

      // Verify fee was deducted from wallet
      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      expect(wallet?.totalUnlockFees).toBe(task9.unlockFee);

      // Verify immutable TaskUnlockTransaction was created
      const unlockTx = await prisma.taskUnlockTransaction.findFirst({
        where: { userId, taskId: task9.id },
      });
      expect(unlockTx).not.toBeNull();
    });
  });

  describe('4. Deposit & Withdrawal Workflows', () => {
    let depositId = '';
    let withdrawalId = '';

    it('submits manual deposit request in PENDING status (wallet not credited yet)', async () => {
      const res = await request(app)
        .post('/api/deposits')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          amount: 2500,
          paymentMethod: 'EASYPAISA',
          transactionReference: `EP-TEST-${Date.now()}`,
          proofEvidence: 'Proof receipt screenshot sent to WhatsApp',
        });

      expect(res.status).toBe(201);
      expect(res.body.deposit.status).toBe('PENDING');
      depositId = res.body.deposit.id;
    });

    it('admin approves deposit: wallet credited exactly once', async () => {
      const balanceBefore = (await prisma.wallet.findUnique({ where: { userId } }))?.availableBalance || 0;

      const res = await request(app)
        .put(`/api/admin/deposits/${depositId}/review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'APPROVE', reviewNotes: 'Verified in bank portal' });

      expect(res.status).toBe(200);

      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      expect(wallet?.availableBalance).toBe(balanceBefore + 2500);

      // Attempting to approve again must be rejected!
      const doubleApprove = await request(app)
        .put(`/api/admin/deposits/${depositId}/review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'APPROVE' });
      expect(doubleApprove.status).toBe(400);
    });

    it('submits withdrawal and reserves funds (preventing double spend)', async () => {
      const balanceBefore = (await prisma.wallet.findUnique({ where: { userId } }))?.availableBalance || 0;
      expect(balanceBefore).toBeGreaterThan(1000);

      const res = await request(app)
        .post('/api/withdrawals')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          amount: 1500,
          paymentMethod: 'JAZZCASH',
          recipientName: 'Royal Tester',
          recipientAccount: '03009876543',
        });

      expect(res.status).toBe(201);
      withdrawalId = res.body.withdrawal.id;

      // Available balance must decrease by 1500, pending balance must increase by 1500
      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      expect(wallet?.availableBalance).toBe(balanceBefore - 1500);
      expect(wallet?.pendingBalance).toBe(1500);
    });

    it('admin approves withdrawal and marks Paid', async () => {
      // 1. Approve
      const approveRes = await request(app)
        .put(`/api/admin/withdrawals/${withdrawalId}/review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'APPROVE', reviewNotes: 'Account details verified' });
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.withdrawal.approvalStatus).toBe('APPROVED');
      expect(approveRes.body.withdrawal.paymentStatus).toBe('NOT_SENT');

      // 2. Mark Paid
      const payoutRes = await request(app)
        .put(`/api/admin/withdrawals/${withdrawalId}/payout`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ payoutReference: `JC-PAYOUT-${Date.now()}` });
      expect(payoutRes.status).toBe(200);
      expect(payoutRes.body.withdrawal.paymentStatus).toBe('PAID');

      // Pending balance reduced, totalWithdrawn increased
      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      expect(wallet?.pendingBalance).toBe(0);
      expect(wallet?.totalWithdrawn).toBe(1500);
    });
  });

  describe('5. Spin Wheel Entitlements & Execution', () => {
    it('ineligible user cannot spin', async () => {
      const res = await request(app)
        .post('/api/spin/play')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('do not have any available spins');
    });

    it('admin assigns spin entitlement and user spins successfully', async () => {
      // Find a cash prize
      const prize = await prisma.spinPrize.findFirst({
        where: { monetaryValue: 500 },
      });
      expect(prize).not.toBeNull();

      // Admin assigns entitlement to user
      const assignRes = await request(app)
        .post('/api/admin/spin/assign')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId,
          assignedPrizeId: prize!.id,
          totalSpins: 1,
        });
      expect(assignRes.status).toBe(201);

      const balanceBefore = (await prisma.wallet.findUnique({ where: { userId } }))?.availableBalance || 0;

      // User spins
      const spinRes = await request(app)
        .post('/api/spin/play')
        .set('Authorization', `Bearer ${userToken}`);

      expect(spinRes.status).toBe(200);
      expect(spinRes.body.prize.id).toBe(prize!.id);
      expect(spinRes.body.remainingSpins).toBe(0);

      // Verify wallet credited
      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      expect(wallet?.availableBalance).toBe(balanceBefore + 500);

      // Cannot spin again with consumed entitlement
      const repeatSpin = await request(app)
        .post('/api/spin/play')
        .set('Authorization', `Bearer ${userToken}`);
      expect(repeatSpin.status).toBe(403);
    });
  });

  describe('6. Security & Authorization Protection', () => {
    it('ordinary user cannot access admin endpoints', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(401);
    });

    it('unauthenticated request is blocked', async () => {
      const res = await request(app).get('/api/user/dashboard');
      expect(res.status).toBe(401);
    });
  });

  describe('7. Single User Entity Targeted Updates & Zero-Reload Isolation', () => {
    it('updates only changed fields of a single user without affecting others', async () => {
      const targetUser = userId ? await prisma.user.findUnique({ where: { id: userId } }) : await prisma.user.findFirst();
      expect(targetUser).not.toBeNull();
      const targetId = targetUser!.id;

      const newName = 'Royal Tester Modified';
      const patchRes = await request(app)
        .patch(`/api/admin/users/${targetId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: newName });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.user).toBeDefined();
      expect(patchRes.body.user.id).toBe(targetId);
      expect(patchRes.body.user.name).toBe(newName);
      // Ensure passwordHash is not returned
      expect(patchRes.body.user.passwordHash).toBeUndefined();

      // Verify in database that only target user was updated
      const updatedUser = await prisma.user.findUnique({ where: { id: targetId } });
      expect(updatedUser?.name).toBe(newName);
    });

    it('returns no-change notice when sending identical field values', async () => {
      const targetUser = userId ? await prisma.user.findUnique({ where: { id: userId } }) : await prisma.user.findFirst();
      expect(targetUser).not.toBeNull();
      const targetId = targetUser!.id;

      const patchRes = await request(app)
        .patch(`/api/admin/users/${targetId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: targetUser!.name });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.message).toContain('No changes detected');
    });

    it('fetches only single user summary without joining unrelated global data', async () => {
      const targetUser = userId ? await prisma.user.findUnique({ where: { id: userId } }) : await prisma.user.findFirst();
      expect(targetUser).not.toBeNull();
      const targetId = targetUser!.id;

      const summaryRes = await request(app)
        .get(`/api/admin/users/${targetId}/summary`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(summaryRes.status).toBe(200);
      expect(summaryRes.body.user).toBeDefined();
      expect(summaryRes.body.user.id).toBe(targetId);
      expect(summaryRes.body.user.walletBalance).toBeDefined();
      expect(summaryRes.body.user.creditPoints).toBeDefined();
      // Ensure big relational joins like taskProgress or depositRequests are not dumped
      expect(summaryRes.body.user.taskProgress).toBeUndefined();
      expect(summaryRes.body.user.depositRequests).toBeUndefined();
    });

    it('fetches only notification quantities for tasks, spins, deposits, and withdrawals', async () => {
      const countRes = await request(app)
        .get('/api/admin/notifications/counts')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(countRes.status).toBe(200);
      expect(countRes.body.counts).toBeDefined();
      expect(typeof countRes.body.counts.total).toBe('number');
      expect(typeof countRes.body.counts.tasks).toBe('number');
      expect(typeof countRes.body.counts.spins).toBe('number');
      expect(typeof countRes.body.counts.deposits).toBe('number');
      expect(typeof countRes.body.counts.withdrawals).toBe('number');
      // Verify no records or data rows are dumped, strictly numbers
      expect(countRes.body.tasks).toBeUndefined();
      expect(countRes.body.submissions).toBeUndefined();
    });
  });
});
