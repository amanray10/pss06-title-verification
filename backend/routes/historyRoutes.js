import express from 'express';
import { historyController } from '../controllers/historyController.js';
import {
  optionalAuth,
  authenticateToken,
  requireAdmin
} from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', optionalAuth, historyController.list);

// --- admin review queue ----------------------------------------------------
// Reading the queue needs a session; deciding a title needs review authority.
router.get('/pending/stats', authenticateToken, historyController.stats);
router.get('/pending/list', authenticateToken, historyController.pending);
router.get('/pending/detail/:applicationRef', authenticateToken, historyController.pendingDetail);
router.patch('/pending/:applicationRef', requireAdmin, historyController.updatePending);

router.get('/:trackingId', optionalAuth, historyController.detail);

export default router;
