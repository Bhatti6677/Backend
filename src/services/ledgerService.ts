import { prisma } from '../prisma';

export class InsufficientBalanceError extends Error {
  constructor(message = 'Insufficient available balance') {
    super(message);
    this.name = 'InsufficientBalanceError';
  }
}

interface TransactionParams {
  userId: string;
  transactionType: string;
  amount: number;
  reason: string;
  actorId?: string;
  actorName?: string;
  relatedEntityId?: string;
  idempotencyKey?: string;
  notes?: string;
}

export const ledgerService = {
  /**
   * Credits funds to a user's wallet with ledger entry
   */
  async creditFunds(
    params: TransactionParams,
    options?: { isDeposit?: boolean; isReward?: boolean; client?: any }
  ) {
    const db = options?.client || prisma;
    const { userId, amount, transactionType, reason, actorId, actorName, relatedEntityId, idempotencyKey, notes } = params;

    if (amount <= 0) {
      throw new Error('Credit amount must be greater than zero');
    }

    if (idempotencyKey) {
      const existing = await db.walletTransaction.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return existing;
      }
    }

    return await db.$transaction(async (tx: any) => {
      // Find or create wallet
      let wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) {
        wallet = await tx.wallet.create({
          data: { userId, availableBalance: 0, pendingBalance: 0, totalEarned: 0, totalDeposited: 0, creditPoints: 100 },
        });
      }

      // Update wallet
      const updateData: any = {
        availableBalance: { increment: amount },
      };
      if (options?.isDeposit) {
        updateData.totalDeposited = { increment: amount };
      }
      if (options?.isReward) {
        updateData.totalEarned = { increment: amount };
      }

      const updatedWallet = await tx.wallet.update({
        where: { userId },
        data: updateData,
      });

      // Create transaction
      const transaction = await tx.walletTransaction.create({
        data: {
          userId,
          transactionType,
          amount,
          currency: 'PKR',
          status: 'COMPLETED',
          relatedEntityId,
          idempotencyKey,
          actorId,
          actorName,
          reason,
          notes,
        },
      });

      return { wallet: updatedWallet, transaction };
    });
  },

  /**
   * Debits funds from a user's wallet (e.g. task unlock fee or admin debit)
   */
  async debitFunds(
    params: TransactionParams,
    options?: { isUnlockFee?: boolean; client?: any }
  ) {
    const db = options?.client || prisma;
    const { userId, amount, transactionType, reason, actorId, actorName, relatedEntityId, idempotencyKey, notes } = params;

    if (amount <= 0) {
      throw new Error('Debit amount must be greater than zero');
    }

    return await db.$transaction(async (tx: any) => {
      const updateData: any = {
        availableBalance: { decrement: amount },
      };
      if (options?.isUnlockFee) {
        updateData.totalUnlockFees = { increment: amount };
      }

      const updateRes = await tx.wallet.updateMany({
        where: { userId, availableBalance: { gte: amount } },
        data: updateData,
      });

      if (updateRes.count !== 1) {
        throw new InsufficientBalanceError(`Insufficient balance. Required: PKR ${amount.toLocaleString()}`);
      }

      const updatedWallet = await tx.wallet.findUnique({ where: { userId } });

      const transaction = await tx.walletTransaction.create({
        data: {
          userId,
          transactionType,
          amount: -amount,
          currency: 'PKR',
          status: 'COMPLETED',
          relatedEntityId,
          idempotencyKey,
          actorId,
          actorName,
          reason,
          notes,
        },
      });

      return { wallet: updatedWallet, transaction };
    });
  },

  /**
   * Reserves funds when a user requests a withdrawal (prevents double spend)
   */
  async reserveWithdrawal(userId: string, amount: number, withdrawalRequestId: string) {
    return await prisma.$transaction(async (tx) => {
      const updateRes = await tx.wallet.updateMany({
        where: { userId, availableBalance: { gte: amount } },
        data: {
          availableBalance: { decrement: amount },
          pendingBalance: { increment: amount },
        },
      });

      if (updateRes.count !== 1) {
        throw new InsufficientBalanceError(`Insufficient available balance for withdrawal request of PKR ${amount}`);
      }

      const updatedWallet = await tx.wallet.findUnique({ where: { userId } });

      const transaction = await tx.walletTransaction.create({
        data: {
          userId,
          transactionType: 'WITHDRAWAL_RESERVATION',
          amount: -amount,
          currency: 'PKR',
          status: 'PENDING',
          relatedEntityId: withdrawalRequestId,
          reason: `Reserved for withdrawal request #${withdrawalRequestId.slice(-6)}`,
        },
      });

      return { wallet: updatedWallet, transaction };
    });
  },

  /**
   * Releases reserved funds back to availableBalance if admin rejects withdrawal
   */
  async releaseWithdrawalReservation(userId: string, amount: number, withdrawalRequestId: string, adminUsername: string) {
    return await prisma.$transaction(async (tx) => {
      const updateRes = await tx.wallet.updateMany({
        where: { userId, pendingBalance: { gte: amount } },
        data: {
          availableBalance: { increment: amount },
          pendingBalance: { decrement: amount },
        },
      });

      if (updateRes.count !== 1) {
        throw new Error(`Cannot release reservation: insufficient pending balance for user ${userId}`);
      }

      const updatedWallet = await tx.wallet.findUnique({ where: { userId } });

      const transaction = await tx.walletTransaction.create({
        data: {
          userId,
          transactionType: 'WITHDRAWAL_REVERSAL',
          amount,
          currency: 'PKR',
          status: 'COMPLETED',
          relatedEntityId: withdrawalRequestId,
          actorName: adminUsername,
          reason: `Reversed reservation for rejected withdrawal #${withdrawalRequestId.slice(-6)}`,
        },
      });

      return { wallet: updatedWallet, transaction };
    });
  },

  /**
   * Finalizes withdrawal when marked Paid
   */
  async finalizeWithdrawalPaid(userId: string, amount: number, withdrawalRequestId: string, adminUsername: string) {
    return await prisma.$transaction(async (tx) => {
      const updateRes = await tx.wallet.updateMany({
        where: { userId, pendingBalance: { gte: amount } },
        data: {
          pendingBalance: { decrement: amount },
          totalWithdrawn: { increment: amount },
        },
      });

      if (updateRes.count !== 1) {
        throw new Error(`Cannot finalize payout: insufficient pending balance for user ${userId}`);
      }

      const updatedWallet = await tx.wallet.findUnique({ where: { userId } });

      const transaction = await tx.walletTransaction.create({
        data: {
          userId,
          transactionType: 'WITHDRAWAL_PAID',
          amount: -amount,
          currency: 'PKR',
          status: 'COMPLETED',
          relatedEntityId: withdrawalRequestId,
          actorName: adminUsername,
          reason: `Payout disbursed for withdrawal #${withdrawalRequestId.slice(-6)}`,
        },
      });

      return { wallet: updatedWallet, transaction };
    });
  },
};
