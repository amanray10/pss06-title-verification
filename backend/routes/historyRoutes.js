import express from 'express';
import { historyController } from '../controllers/historyController.js';
import { optionalAuth, authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', optionalAuth, historyController.list);
router.get('/pending/list', optionalAuth, historyController.pending);
router.patch('/pending/:applicationRef', authenticateToken, historyController.updatePending);
router.get('/:trackingId', optionalAuth, historyController.detail);

export default router;
