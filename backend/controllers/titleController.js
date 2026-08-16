/**
 * PSS06 - Title verification endpoints.
 *
 * Flow for POST /api/titles/verify:
 *
 *   validate -> AI service (/ai/verify) -> persist result + evidence
 *            -> return decision, score, probability, evidence, explanation
 *
 * The AI service is the only thing that decides. This controller's job is
 * transport, validation and the audit trail.
 */

import {
  databaseService,
  makeTrackingId,
  makeApplicationRef
} from '../services/databaseService.js';
import { aiService, AiServiceError } from '../services/aiService.js';
import { query } from '../config/db.js';

const MAX_TITLE_LENGTH = 300;

export const titleController = {
  // POST /api/titles/verify
  async verify(req, res) {
    const {
      title, language, publicationType, periodicity, publisher, state,
      trackApplication = false
    } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please enter the publication title you want to verify.'
      });
    }
    if (String(title).length > MAX_TITLE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Titles cannot exceed ${MAX_TITLE_LENGTH} characters.`
      });
    }

    let result;
    try {
      result = await aiService.verify({
        title: String(title).trim(),
        language: language || null,
        publicationType: publicationType || null,
        periodicity: periodicity || null,
        publisher: publisher || null,
        state: state || null,
        applicantId: req.user?.id || null,
        explain: true
      });
    } catch (err) {
      const status = err instanceof AiServiceError ? err.status : 502;
      console.error('[titles] AI service call failed:', err.message);
      return res.status(status).json({
        success: false,
        message: err.message,
        hint: 'Start the Python AI service:  cd ai-service && uvicorn main:app --port 8000'
      });
    }

    const trackingId = makeTrackingId();
    let persisted = false;
    let verificationId = null;
    let applicationRef = null;

    try {
      const saved = await databaseService.saveVerification({
        trackingId,
        userId: req.user?.id || null,
        request: { language, publicationType, periodicity, publisher, state },
        result
      });
      verificationId = saved.id;
      persisted = true;
    } catch (err) {
      // A recording failure must not deny the applicant their answer.
      console.error('[titles] could not persist verification:', err.message);
    }

    // Requirement 5.b - a title that has been applied for blocks later
    // look-alike submissions, so it joins the live corpus straight away.
    if (trackApplication && result.decision !== 'REJECT') {
      applicationRef = makeApplicationRef();
      try {
        await databaseService.createPendingApplication({
          applicationRef,
          userId: req.user?.id || null,
          verificationId,
          title: result.title,
          normalizedTitle: result.normalizedTitle,
          language, periodicity, publisher, state
        });
        await aiService.registerPending({
          title: result.title,
          applicationRef,
          language: language || null,
          periodicity: periodicity || null,
          publisher: publisher || null,
          state: state || null
        });
      } catch (err) {
        console.error('[titles] could not queue the application:', err.message);
        applicationRef = null;
      }
    }

    return res.json({
      success: true,
      trackingId,
      persisted,
      applicationRef,
      result
    });
  },

  // POST /api/titles/guidelines - live typing feedback
  async guidelines(req, res) {
    const { title } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.json({ success: true, clean: true, findings: [] });
    }
    try {
      const data = await aiService.guidelines(String(title).trim());
      return res.json({ success: true, ...data });
    } catch (err) {
      return res.status(503).json({ success: false, message: err.message });
    }
  },

  // GET /api/titles/search?q=...&limit=20 - browse the registry
  async search(req, res) {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limit || 20), 100);
    if (!q) {
      return res.json({ success: true, results: [], total: 0 });
    }
    try {
      const results = await query(
        `SELECT registration_number, title, language, periodicity, publisher,
                owner, publication_state, publication_district, registration_date
         FROM prgi_titles
         WHERE title LIKE ?
         ORDER BY title ASC
         LIMIT ${limit}`,
        [`%${q.toUpperCase()}%`]
      );
      return res.json({ success: true, results, total: results.length });
    } catch (err) {
      console.error('[titles] registry search failed:', err.message);
      return res.status(503).json({
        success: false,
        message: 'Registry search is unavailable (database not reachable).'
      });
    }
  },

  // GET /api/titles/engine - which AI components actually loaded
  async engine(_req, res) {
    const health = await aiService.safeHealth();
    return res.json({ success: true, ...health });
  }
};

export default titleController;
