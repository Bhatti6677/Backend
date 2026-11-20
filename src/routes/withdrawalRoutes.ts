import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { ledgerService, InsufficientBalanceError } from '../services/ledgerService';
import {
  getAllLevelWithdrawalNotices,
  getLevelWithdrawalNotice,
} from '../services/levelNoticeService';
import { getWithdrawalEligibility } from '../services/withdrawalEligibilityService';
import { financialActionLimiter } from '../middleware/rateLimiter';

const router = Router();

const withdrawalSchema = z.object({
  amount: z.number().positive('Withdrawal amount must be greater than zero'),
  paymentMethod: z.enum(['EASYPAISA', 'JAZZCASH', 'BANK_TRANSFER']),
  recipientName: z.string().min(2, 'Recipient account title/name is required'),
  recipientAccount: z.string().min(8, 'Recipient account or mobile number is required'),
  notes: z.string().optional().nullable(),
});

/**
 * GET /api/withdrawals
 * User withdrawal history and level-aware quota
 */
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.user!.id;
    const withdrawals = await prisma.withdrawalRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const eligibility = await getWithdrawalEligibility(userId);
    const levels = await prisma.level.findMany({ orderBy: { levelNumber: 'asc' } });
    const notices = await getAllLevelWithdrawalNotices();

    res.json({
      withdrawals,
      withdrawalQuota: {
        completedLevelsCount: eligibility.completedLevelsCount,
        currentLevelNumber: eligibility.currentLevelNumber,
        withdrawalNotice: eligibility.withdrawalNotice,
        eligiblePercent: eligibility.eligiblePercent,
        maxWithdrawableAmount: eligibility.maxWithdrawableAmount,
        availableBalance: eligibility.availableBalance,
        isLocked: eligibility.isLocked,
        lockReason: eligibility.lockReason,
        stage: eligibility.stage,
        isUnrestricted: eligibility.isUnrestricted,
        hasWithdrawnLevel1: eligibility.hasWithdrawnLevel1,
        hasWithdrawnLevel2: eligibility.hasWithdrawnLevel2,
        isAdminLocked: eligibility.isAdminLocked,
        adminLockReason: eligibility.adminLockReason,
        allLevelNotices: levels.map((l) => ({
          levelNumber: l.levelNumber,
          title: l.title,
          notice: notices[l.levelNumber] || '',
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/withdrawals
 * Submits withdrawal request with balance reservation
 */
router.post('/', financialActionLimiter, requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.user!.id;
    const validated = withdrawalSchema.parse(req.body);

    const eligibility = await getWithdrawalEligibility(userId);

    // 1. Enforce lock rule
    if (eligibility.isLocked) {
      return res.status(400).json({
        error: eligibility.withdrawalNotice || 'Withdrawals are currently locked.',
        isLocked: true,
      });
    }

    // 2. Verify wallet balance
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet || wallet.availableBalance <= 0) {
      return res.status(400).json({
        error: 'You have no available balance to withdraw.',
      });
    }

    // 3. Amount validation per stage
    let tag = '[WITHDRAWAL]';
    if (eligibility.stage === 'LEVEL_1') {
      tag = '[LEVEL_1_WITHDRAWAL]';
      if (Math.abs(validated.amount - wallet.availableBalance) > 0.01) {
        return res.status(400).json({
          error: `Level 1 completion requires withdrawing your total account balance of PKR ${wallet.availableBalance.toLocaleString()}.`,
          exactAvailable: wallet.availableBalance,
        });
      }
    } else if (eligibility.stage === 'LEVEL_2') {
      tag = '[LEVEL_2_WITHDRAWAL]';
      if (Math.abs(validated.amount - wallet.availableBalance) > 0.01) {
        return res.status(400).json({
          error: `Level 2 completion requires requesting your total account balance of PKR ${wallet.availableBalance.toLocaleString()}.`,
          exactAvailable: wallet.availableBalance,
        });
      }
    } else if (eligibility.isUnrestricted) {
      tag = '[UNRESTRICTED_WITHDRAWAL]';
      if (validated.amount > wallet.availableBalance || validated.amount <= 0) {
        return res.status(400).json({
          error: `Withdrawal amount must not exceed your available balance of PKR ${wallet.availableBalance.toLocaleString()}.`,
          exactAvailable: wallet.availableBalance,
        });
      }
    }

    const reqNotes = validated.notes
      ? `${tag} ${validated.notes.trim()}`
      : tag;

    // Execute atomic reservation
    const withdrawal = await prisma.$transaction(async (tx) => {
      // 1. Guard against concurrent duplicate pending withdrawals
      const existingPending = await tx.withdrawalRequest.findFirst({
        where: { userId, approvalStatus: 'PENDING' },
      });
      if (existingPending) {
        throw new Error('DUPLICATE_PENDING_WITHDRAWAL');
      }

      // 2. Race-proof conditional wallet deduction: only succeeds if availableBalance >= validated.amount
      const walletUpdate = await tx.wallet.updateMany({
        where: {
          userId,
          availableBalance: { gte: validated.amount },
        },
        data: {
          availableBalance: { decrement: validated.amount },
          pendingBalance: { increment: validated.amount },
        },
      });

      if (walletUpdate.count !== 1) {
        throw new InsufficientBalanceError('Insufficient available balance to complete withdrawal request.');
      }

      // 3. Create withdrawal request
      const reqRecord = await tx.withdrawalRequest.create({
        data: {
          userId,
          amount: validated.amount,
          paymentMethod: validated.paymentMethod,
          recipientName: validated.recipientName.trim(),
          recipientAccount: validated.recipientAccount.trim(),
          notes: reqNotes,
          approvalStatus: 'PENDING',
          paymentStatus: 'NOT_SENT',
        },
      });

      // 4. Ledger record
      await tx.walletTransaction.create({
        data: {
          userId,
          transactionType: 'WITHDRAWAL_RESERVATION',
          amount: -validated.amount,
          currency: 'PKR',
          status: 'PENDING',
          relatedEntityId: reqRecord.id,
          reason: `Reserved for withdrawal request to ${validated.recipientName} (${validated.paymentMethod})`,
        },
      });

      return reqRecord;
    });

    res.status(201).json({
      message: 'Withdrawal request submitted! Funds have been reserved pending review.',
      withdrawal,
    });
  } catch (err: any) {
    if (err?.message === 'DUPLICATE_PENDING_WITHDRAWAL') {
      return res.status(400).json({
        error: 'You already have a withdrawal request pending review. Please wait for administration to process it before submitting another.',
      });
    }
    if (err instanceof InsufficientBalanceError) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

export default router;
