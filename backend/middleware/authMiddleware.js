/**
 * PSS06 - JWT authentication middleware.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { databaseService } from '../services/databaseService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * The signing key for every session token in the system.
 *
 * There is deliberately NO hard-coded fallback. A literal default committed to
 * a public repository is not a default, it is a published master key: anyone
 * who can read this file could mint a token claiming role "Administrator" and
 * walk straight into the review queue of any deployment that forgot to set the
 * variable.
 *
 * In production we refuse to start. In development we generate a random key
 * per boot, which keeps `npm start` working out of the box while making the
 * consequence obvious - every restart signs everybody out until a real
 * JWT_SECRET is put in .env.
 */
function resolveJwtSecret() {
  const configured = process.env.JWT_SECRET;
  if (configured && configured.length >= 32) return configured;

  if (configured) {
    throw new Error(
      'JWT_SECRET is set but shorter than 32 characters. Use a long random '
      + 'string, e.g.  node -e "console.log(require(\'crypto\')'
      + '.randomBytes(48).toString(\'hex\'))"'
    );
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET is not set. Refusing to start in production with an '
      + 'ephemeral signing key. Add JWT_SECRET to your .env file.'
    );
  }

  const ephemeral = crypto.randomBytes(48).toString('hex');
  console.warn(
    '\n[auth] WARNING: JWT_SECRET is not set in .env.\n'
    + '[auth] Using a random key generated for this process only - every '
    + 'restart will invalidate all sessions.\n'
    + '[auth] Add this line to your .env to make sessions persist:\n'
    + `[auth]   JWT_SECRET=${ephemeral}\n`
  );
  return ephemeral;
}

export const JWT_SECRET = resolveJwtSecret();
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
