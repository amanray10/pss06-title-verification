/**
 * PSS06 - Authentication (bcrypt password hashing + JWT sessions, MySQL-backed).
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { databaseService } from '../services/databaseService.js';
import { signToken, publicUser } from '../middleware/authMiddleware.js';

const SALT_ROUNDS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const authController = {
  // POST /api/auth/register
  async register(req, res) {
    try {
      const { username, email, mobile, organization, password, confirmPassword } = req.body;

      if (!username || !email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Full name, institutional email and password are required.'
        });
      }
      if (!EMAIL_RE.test(String(email))) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address.'
        });
      }
      if (String(password).length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 6 characters long.'
        });
      }
      if (confirmPassword !== undefined && password !== confirmPassword) {
        return res.status(400).json({
          success: false,
          message: 'Password confirmation does not match.'
        });
      }

      const existing = await databaseService.findUserByEmail(email);
      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'An account with this institutional email already exists.'
        });
      }

      const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);
      const id = `usr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const verificationCode = String(Math.floor(100000 + Math.random() * 900000));

      const user = await databaseService.createUser({
        id,
        username: String(username).trim(),
        email,
        mobile,
        organization,
        passwordHash,
        verificationCode
      });

      return res.status(201).json({
        success: true,
        message: 'Account registered successfully.',
        user: publicUser(user),
        token: signToken(user),
        // Surfaced only because there is no mail server in this deployment.
        verificationCode
      });
    } catch (err) {
      console.error('[auth] register failed:', err);
      return res.status(500).json({
        success: false,
        message: 'Registration failed. Is the database running?'
      });
    }
  },

  // POST /api/auth/login
  async login(req, res) {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email address and password are required.'
        });
      }

      const user = await databaseService.findUserByEmail(email);
      // Same message for both failure modes - do not leak which emails exist.
      const invalid = {
        success: false,
        message: 'Invalid official credentials or password.'
      };
      if (!user) return res.status(401).json(invalid);

      const ok = await bcrypt.compare(String(password), user.password_hash);
      if (!ok) return res.status(401).json(invalid);

      await databaseService.touchLogin(user.id);

      return res.json({
        success: true,
        message: 'Signed in successfully.',
        user: publicUser(user),
        token: signToken(user)
      });
    } catch (err) {
      console.error('[auth] login failed:', err);
      return res.status(500).json({
        success: false,
        message: 'Sign-in failed. Is the database running?'
      });
    }
  },

  // POST /api/auth/verify-email
  async verifyEmail(req, res) {
    try {
      const email = req.body?.email || req.user?.email;
      if (!email) {
        return res.status(400).json({
          success: false, message: 'Email address is required.'
        });
      }
      const user = await databaseService.markEmailVerified(email);
      if (!user) {
        return res.status(404).json({ success: false, message: 'Account not found.' });
      }
      return res.json({
        success: true,
        message: 'Email address verified successfully.',
        user: publicUser(user)
      });
    } catch (err) {
      console.error('[auth] verifyEmail failed:', err);
      return res.status(500).json({ success: false, message: 'Verification failed.' });
    }
  },

  // POST /api/auth/resend-verification
  async resendVerification(req, res) {
    try {
      const { email } = req.body;
      const user = await databaseService.findUserByEmail(email);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'No account registered with this email.'
        });
      }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await databaseService.setVerificationCode(user.id, code);
      return res.json({
        success: true,
        message: `A new verification code has been dispatched. (Demo code: ${code})`
      });
    } catch (err) {
      console.error('[authController.resendVerification] error:', err);
      return res.status(500).json({ success: false, message: 'Failed to resend code.' });
    }
  },

  // POST /api/auth/google
  async googleLogin(req, res) {
    try {
      const { credential, email: bodyEmail, name: bodyName } = req.body;
      let email = bodyEmail;
      let name = bodyName;

      if (credential) {
        try {
          const parts = credential.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
            if (payload.email) {
              email = payload.email;
              name = payload.name || payload.given_name || payload.email.split('@')[0];
            }
          }
        } catch (e) {
          console.error('[GoogleAuth] Failed to parse credential:', e);
        }
      }

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Valid Google account email is required.'
        });
      }

      let user = await databaseService.findUserByEmail(email);

      if (!user) {
        const id = `usr_g_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
        const dummyHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), SALT_ROUNDS);
        user = await databaseService.createUser({
          id,
          username: name || email.split('@')[0],
          email,
          mobile: null,
          organization: 'Google Verified User',
          passwordHash: dummyHash,
          role: 'Administrator'
        });
        await databaseService.setUserVerified(id);
        user = await databaseService.findUserById(id);
      }

      return res.status(200).json({
        success: true,
        message: 'Google authentication successful.',
        user: publicUser(user),
        token: signToken(user)
      });
    } catch (err) {
      console.error('[authController.googleLogin] error:', err);
      return res.status(500).json({
        success: false,
        message: 'Google login failed on server.'
      });
    }
  },

  // GET /api/auth/me
  async getMe(req, res) {
    return res.json({ success: true, user: req.user });
  }
};

export default authController;
