/**
 * PSS06 - Verification history and the pending-application queue.
 */

import { databaseService } from '../services/databaseService.js';
import { aiService } from '../services/aiService.js';
import { sendMail, decisionEmail } from '../services/mailService.js';

const ACCEPT_STATUSES = ['ACCEPT', 'ACCEPTED', 'APPROVED'];
const REJECT_STATUSES = ['REJECT', 'REJECTED'];

export const historyController = {
  // GET /api/history?decision=&search=&limit=&offset=&scope=
  async list(req, res) {
    try {
      const scope = String(req.query.scope || 'mine');
      const { rows, total } = await databaseService.listVerifications({
        userId: scope === 'all' ? null : req.user?.id || null,
        decision: req.query.decision || null,
        search: req.query.search || null,
        limit: Math.min(Number(req.query.limit || 100), 500),
        offset: Number(req.query.offset || 0)
      });
      return res.json({ success: true, total, records: rows });
    } catch (err) {
      console.error('[history] list failed:', err.message);
      return res.status(503).json({
        success: false,
        message: 'History is unavailable (database not reachable).',
        records: [],
        total: 0
      });
    }
  },

  // GET /api/history/:trackingId
  async detail(req, res) {
    try {
      const record = await databaseService.getVerification(
        req.params.trackingId,
        null
      );
      if (!record) {
        return res.status(404).json({
          success: false,
          message: 'No verification found with that tracking ID.'
        });
      }
      return res.json({ success: true, record });
    } catch (err) {
      console.error('[history] detail failed:', err.message);
      return res.status(503).json({ success: false, message: err.message });
    }
  },

  // GET /api/history/pending/list
  async pending(req, res) {
    try {
      const scope = String(req.query.scope || 'mine');
      const userId = scope === 'all' ? null : req.user?.id || null;
      const includeDecided = String(req.query.includeDecided || '') === 'true';
      const status = req.query.status || null;
      const search = req.query.search || null;

      const rows = await databaseService.listPendingApplications({
        userId,
        includeDecided,
        status,
        search
      });
      return res.json({ success: true, applications: rows });
    } catch (err) {
      console.error('[history] pending list failed:', err);
      return res.status(503).json({
        success: false, message: err.message, applications: []
      });
    }
  },

  // GET /api/history/pending/detail/:applicationRef
  async pendingDetail(req, res) {
    try {
      const record = await databaseService.getPendingApplicationByRef(req.params.applicationRef);
      if (!record) {
        return res.status(404).json({
          success: false,
          message: 'No pending application found with that reference ID.'
        });
      }
      return res.json({ success: true, application: record });
    } catch (err) {
      console.error('[history] pendingDetail failed:', err);
      return res.status(503).json({ success: false, message: err.message });
    }
  },

  // GET /api/history/pending/stats
  async stats(req, res) {
    try {
      const stats = await databaseService.getAdminStats();
      return res.json({ success: true, stats });
    } catch (err) {
      console.error('[history] stats failed:', err);
      return res.status(503).json({
        success: false,
        message: err.message,
        stats: { pendingReviews: 0, acceptedToday: 0, rejectedToday: 0, totalRequests: 0 }
      });
    }
  },

  // PATCH /api/history/pending/:applicationRef
  async updatePending(req, res) {
    const allowed = [
      'PENDING', 'UNDER_REVIEW', 'MANUAL_REVIEW',
      'APPROVED', 'ACCEPTED', 'WITHDRAWN', 'REJECTED', 'ACCEPT', 'REJECT'
    ];
    let status = String(req.body?.status || '').toUpperCase();
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${allowed.join(', ')}`
      });
    }

    // A written justification is mandatory for BOTH outcomes. An approval
    // with no stated ground is exactly as unaccountable as a rejection with
    // none - the whole point of manual review is that a human explains why.
    const raw = req.body?.reason ?? req.body?.rejectionReason;
    const reason = raw ? String(raw).trim() : null;
    const isDecision = [...ACCEPT_STATUSES, ...REJECT_STATUSES].includes(status);

    if (isDecision && (!reason || reason.length < 10)) {
      return res.status(400).json({
        success: false,
        message:
          'A written reason of at least 10 characters is required to '
          + `${status.startsWith('REJ') ? 'reject' : 'accept'} a title held for `
          + 'manual review. It is recorded in the audit trail against your name.'
      });
    }

    const reviewedBy = req.user?.username || req.user?.email || req.user?.id || 'Administrator';

    try {
      const result = await databaseService.updatePendingStatus(
        req.params.applicationRef,
        status,
        { reviewedBy, reason }
      );

      // Approving, accepting or withdrawing changes what later applicants are checked
      // against, so the AI corpus is refreshed.
      if (['APPROVED', 'ACCEPTED', 'WITHDRAWN', 'REJECTED', 'REJECT'].includes(status)) {
        aiService.reload().catch(() => {});
      }

      // -------------------------------------------------------------------
      // Notify the applicant. A mail failure must never roll back or hide a
      // decision that is already recorded, so the outcome is reported back to
      // the officer rather than thrown.
      // -------------------------------------------------------------------
      let notification = { attempted: false };
      if (isDecision) {
        notification = await notifyApplicant({
          applicationRef: req.params.applicationRef,
          accepted: ACCEPT_STATUSES.includes(status),
          reason,
          reviewedBy
        });
      }

      return res.json({
        success: true,
        message: `Title status updated to ${result.status}.`
          + (notification.sent ? ` The applicant has been notified at ${notification.to}.` : ''),
        notification,
        ...result
      });
    } catch (err) {
      console.error('[history] updatePending failed:', err);
      return res.status(503).json({ success: false, message: err.message });
    }
  }
};

/**
 * Email the applicant the outcome of their manual review.
 * @returns {Promise<{attempted:boolean, sent?:boolean, to?:string, error?:string}>}
 */
async function notifyApplicant({ applicationRef, accepted, reason, reviewedBy }) {
  try {
    const app = await databaseService.getPendingApplicationByRef(applicationRef);
    const to = app?.submittedByEmail;

    if (!to) {
      return {
        attempted: false,
        error: 'This application has no applicant email on record '
          + '(it was submitted without a signed-in account), so no notification was sent.'
      };
    }

    const { subject, html } = decisionEmail({
      name: app.submittedByName,
      title: app.title,
      applicationRef,
      accepted,
      reason,
      reviewedBy,
      decidedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    });

    const delivery = await sendMail({ to, subject, html });
    return { attempted: true, to, ...delivery };
  } catch (err) {
    console.error('[history] applicant notification failed:', err.message);
    return { attempted: true, sent: false, error: err.message };
  }
}

export default historyController;
