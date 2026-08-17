/**
 * PSS06 - JWT authentication middleware.
 */

import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { databaseService } from '../services/databaseService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const JWT_SECRET =
  process.env.JWT_SECRET || 'pss06_prgi_title_verification_secret_key_2026';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    mobile: row.mobile,
    organization: row.organization,
    role: row.role,
    isVerified: Boolean(row.is_verified)
  };
}

function extractToken(req) {
  const header = req.headers['authorization'];
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** Hard gate - 401 if there is no valid session. */
export async function authenticateToken(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required. Please sign in to continue.'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await databaseService.findUserById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid session. This account no longer exists.'
      });
    }
    req.user = publicUser(user);
    return next();
  } catch (err) {
    return res.status(403).json({
      success: false,
      message: 'Session expired or invalid token. Please sign in again.'
    });
  }
}

/** Roles allowed to accept or reject a title held in manual review. */
export const REVIEW_ROLES = ['administrator', 'admin', 'verification officer', 'officer'];

export function isReviewer(user) {
  const role = String(user?.role || '').toLowerCase();
  return REVIEW_ROLES.some((r) => role.includes(r));
}

/**
 * Hard gate for the admin review queue.
 *
 * Hiding the nav item in the sidebar is cosmetic - anyone can still call the
 * API with curl. The decision endpoint is the one that actually changes a
 * title's fate, so the role check has to live here on the server.
 */
export async function requireAdmin(req, res, next) {
  return authenticateToken(req, res, () => {
    if (!isReviewer(req.user)) {
      return res.status(403).json({
        success: false,
        message:
          `Your account has the role "${req.user?.role || 'unknown'}", which `
          + 'does not carry PRGI review authority. Only an Administrator or '
          + 'Verification Officer can decide a title held for manual review.'
      });
    }
    return next();
  });
}

/**
 * Soft gate - attaches req.user when a valid token is present but never
 * blocks. Used on /verify so the checker can be demonstrated without a login
 * while still attributing results to a signed-in officer when there is one.
 */
export async function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await databaseService.findUserById(decoded.id);
    if (user) req.user = publicUser(user);
  } catch {
    /* ignore - the request continues anonymously */
  }
  return next();
}

export default authenticateToken;
