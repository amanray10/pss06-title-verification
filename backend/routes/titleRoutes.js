import express from 'express';
import { titleController } from '../controllers/titleController.js';
import { optionalAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// optionalAuth: the checker works without a session, but when an officer is
// signed in the result is attributed to them in the audit trail.
router.post('/verify', optionalAuth, titleController.verify);
router.post('/guidelines', titleController.guidelines);
router.get('/search', optionalAuth, titleController.search);
router.get('/engine', titleController.engine);

export default router;
