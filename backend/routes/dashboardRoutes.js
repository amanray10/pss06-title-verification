import express from 'express';
import { dashboardController } from '../controllers/dashboardController.js';
import { optionalAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/overview', optionalAuth, dashboardController.overview);

export default router;
