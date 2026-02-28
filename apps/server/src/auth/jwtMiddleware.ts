/**
 * JWT middleware for Express routes and Socket.io connections.
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  userId: string;
  walletAddress: string;
  iat: number;
  exp: number;
}

export interface AuthRequest extends Request {
  jwtPayload: JwtPayload;
}

// ─── Core verifier ────────────────────────────────────────────────────────────

export function verifyJwt(token: string): JwtPayload | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');

  try {
    return jwt.verify(token, secret) as JwtPayload;
  } catch {
    return null;
  }
}

// ─── Express middleware ───────────────────────────────────────────────────────

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header missing' });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyJwt(token);

  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  (req as AuthRequest).jwtPayload = payload;
  next();
}

// ─── Socket.io helper ─────────────────────────────────────────────────────────
// Call this from SocketHandler to extract userId from handshake auth.

export function extractSocketUser(token: string | undefined): JwtPayload | null {
  if (!token) return null;
  return verifyJwt(token);
}
