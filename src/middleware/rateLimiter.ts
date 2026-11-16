import rateLimit from 'express-rate-limit';

/**
 * General API Limiter: Prevents scraping and denial of service.
 * Allows 300 requests per minute per IP.
 */
export const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP address. Please slow down.',
    retryAfterSeconds: 60,
  },
});

/**
 * Auth Limiter: Guards member login and registration against credential stuffing.
 * Allows 20 requests per 15 minutes per IP.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts. Please wait 15 minutes before trying again.',
  },
});

/**
 * Admin Auth Limiter: Ultra-strict protection on admin panel login and OTP attempts.
 * Allows 10 requests per 15 minutes per IP.
 */
export const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Security Lock: Too many failed administrator login attempts. Access temporarily throttled.',
  },
});

/**
 * Referral Validation Limiter: Prevents brute-forcing 6-letter admin invitation codes.
 * Allows 20 code checks per minute per IP.
 */
export const referralValidationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many invitation code validations. Please wait a minute before trying again.',
  },
});

/**
 * Financial Limiter: Throttles rapid spin execution and withdrawal requests.
 * Allows 15 actions per minute.
 */
export const financialActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many transactions submitted in a short period. Please wait a moment.',
  },
});
