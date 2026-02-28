/**
 * Express rate limiters.
 *
 * authLimiter    – tight limit for nonce/verify endpoints (prevents brute force)
 * generalLimiter – wider limit for all other API routes
 */

import rateLimit from 'express-rate-limit';

/** 10 requests per minute per IP — for auth endpoints */
export const authLimiter = rateLimit({
  windowMs: 60 * 1_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

/** 100 requests per 15 minutes per IP — for all API routes */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
