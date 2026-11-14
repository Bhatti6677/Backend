import { prisma } from '../prisma';

export interface OfficialPrizeConfig {
  name: string;
  displayLabel: string;
  prizeType: 'CASH' | 'PHYSICAL';
  monetaryValue: number;
  color: string;
  icon: string;
  imageUrl?: string;
}

export const OFFICIAL_SPIN_PRIZES: OfficialPrizeConfig[] = [
  {
    name: 'PKR 50',
    displayLabel: 'PKR 50',
    prizeType: 'CASH',
    monetaryValue: 50,
    color: '#1459E8',
    icon: 'Coins',
    imageUrl: '/images/spin/product-cash-bundle.jpg',
  },
  {
    name: 'PKR 100',
    displayLabel: 'PKR 100',
    prizeType: 'CASH',
    monetaryValue: 100,
    color: '#792BFF',
    icon: 'Gift',
    imageUrl: '/images/spin/product-cash-bundle.jpg',
  },
  {
    name: 'Suzuki Alto Car',
    displayLabel: 'Alto Car',
    prizeType: 'PHYSICAL',
    monetaryValue: 2500000,
    color: '#059669',
    icon: 'Car',
    imageUrl: '/images/spin/product-car.jpg',
  },
  {
    name: 'PKR 3,000',
    displayLabel: 'PKR 3,000',
    prizeType: 'CASH',
    monetaryValue: 3000,
    color: '#DC2626',
    icon: 'Crown',
    imageUrl: '/images/spin/product-cash-bundle.jpg',
  },
  {
    name: 'PKR 1,000',
    displayLabel: 'PKR 1,000',
    prizeType: 'CASH',
    monetaryValue: 1000,
    color: '#0284C7',
    icon: 'Sparkles',
    imageUrl: '/images/spin/product-cash-bundle.jpg',
  },
  {
    name: 'PKR 5,000',
    displayLabel: 'PKR 5,000 Mega',
    prizeType: 'CASH',
    monetaryValue: 5000,
    color: '#D97706',
    icon: 'Trophy',
    imageUrl: '/images/spin/spin-jackpot-treasure.jpg',
  },
  {
    name: 'Expensive Watch',
    displayLabel: 'Expensive Watch',
    prizeType: 'PHYSICAL',
    monetaryValue: 45000,
    color: '#4F46E5',
    icon: 'Watch',
    imageUrl: '/images/spin/product-watch.jpg',
  },
  {
    name: 'iPhone 15 Pro',
    displayLabel: 'iPhone 15 Pro',
    prizeType: 'PHYSICAL',
    monetaryValue: 350000,
    color: '#EAB308',
    icon: 'Smartphone',
    imageUrl: '/images/spin/product-smartphone.jpg',
  },
];

/**
 * Ensures the database contains the 8 canonical spin prizes, in matching order and
 * attributes with the frontend fortune wheel. Safely migrates legacy prize records
 * without breaking existing relationships.
 */
export async function ensureOfficialSpinPrizes() {
  const existing = await prisma.spinPrize.findMany();

  if (existing.length === 0) {
    for (const p of OFFICIAL_SPIN_PRIZES) {
      await prisma.spinPrize.create({
        data: {
          name: p.name,
          displayLabel: p.displayLabel,
          prizeType: p.prizeType,
          monetaryValue: p.monetaryValue,
          color: p.color,
          icon: p.icon,
          status: 'ACTIVE',
        },
      });
    }
  } else {
    for (const official of OFFICIAL_SPIN_PRIZES) {
      const match = existing.find((e) => {
        if (e.name === official.name || e.displayLabel === official.displayLabel) return true;
        if (official.name === 'PKR 3,000' && (e.monetaryValue === 3000 || e.monetaryValue === 500 || e.id === 'prize_4')) {
          return true;
        }
        // Legacy car aliases
        if (
          official.name === 'Suzuki Alto Car' &&
          (e.name.includes('250') ||
            e.displayLabel.includes('250') ||
            e.name.toLowerCase().includes('alto') ||
            e.name.toLowerCase().includes('car'))
        ) {
          return true;
        }
        // Legacy watch aliases
        if (
          official.name === 'Expensive Watch' &&
          (e.name.toLowerCase().includes('watch') || e.displayLabel.toLowerCase().includes('watch'))
        ) {
          return true;
        }
        // Legacy phone aliases
        if (
          official.name === 'iPhone 15 Pro' &&
          (e.name.toLowerCase().includes('smartphone') ||
            e.name.toLowerCase().includes('phone') ||
            e.displayLabel.toLowerCase().includes('smartphone') ||
            e.displayLabel.toLowerCase().includes('iphone'))
        ) {
          return true;
        }
        // Exact cash matches
        if (official.prizeType === 'CASH' && e.monetaryValue === official.monetaryValue) {
          return true;
        }
        return false;
      });

      if (match) {
        await prisma.spinPrize.update({
          where: { id: match.id },
          data: {
            name: official.name,
            displayLabel: official.displayLabel,
            prizeType: official.prizeType,
            monetaryValue: official.monetaryValue,
            color: official.color,
            icon: official.icon,
            status: 'ACTIVE',
          },
        });
      } else {
        await prisma.spinPrize.create({
          data: {
            name: official.name,
            displayLabel: official.displayLabel,
            prizeType: official.prizeType,
            monetaryValue: official.monetaryValue,
            color: official.color,
            icon: official.icon,
            status: 'ACTIVE',
          },
        });
      }
    }
  }

  // Return the canonical 8 prizes in exact frontend display order
  const allActive = await prisma.spinPrize.findMany({
    where: { status: 'ACTIVE' },
  });

  const orderedPrizes = OFFICIAL_SPIN_PRIZES.map((off) => {
    const found = allActive.find(
      (a) => a.name === off.name || a.displayLabel === off.displayLabel
    );
    if (found) return found;
    return {
      id: `p-${off.name.replace(/\s+/g, '-').toLowerCase()}`,
      ...off,
      inventory: 999999,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });

  return orderedPrizes;
}
