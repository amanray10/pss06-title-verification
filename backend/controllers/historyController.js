/**
 * PSS06 - Verification history and the pending-application queue.
 */

import { databaseService } from '../services/databaseService.js';
import { aiService } from '../services/aiService.js';

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
      const rows = await databaseService.listPendingApplications(
        String(req.query.scope || 'mine') === 'all' ? null : req.user?.id || null,
        String(req.query.includeDecided || '') === 'true'
      );
      return res.json({ success: true, applications: rows });
    } catch (err) {
      return res.status(503).json({
        success: false, message: err.message, applications: []
      });
    }
  },

  // PATCH /api/history/pending/:applicationRef
  async updatePending(req, res) {
    const allowed = ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'WITHDRAWN', 'REJECTED'];
    const status = String(req.body?.status || '').toUpperCase();
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${allowed.join(', ')}`
      });
    }
    try {
      await databaseService.updatePendingStatus(req.params.applicationRef, status);
      // Approving or withdrawing changes what later applicants are checked
      // against, so the AI corpus is refreshed.
      if (['APPROVED', 'WITHDRAWN', 'REJECTED'].includes(status)) {
        aiService.reload().catch(() => {});
      }
      return res.json({ success: true, applicationRef: req.params.applicationRef, status });
    } catch (err) {
      return res.status(503).json({ success: false, message: err.message });
    }
  }
};

export default historyController;
