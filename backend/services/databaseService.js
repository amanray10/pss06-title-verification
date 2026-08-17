/**
 * PSS06 - All SQL in one place.
 *
 * Two responsibilities:
 *   1. persist every verification and its evidence (the audit trail), and
 *   2. keep the pending-application queue that later submissions are checked
 *      against (requirement 5.b).
 *
 * Every method degrades gracefully when MySQL is down: the verification itself
 * still works, it just is not recorded, and the caller is told so.
 */

import crypto from 'crypto';
import { pool, query, isConnected, checkConnection } from '../config/db.js';

const num = (v, fallback = null) =>
  v === undefined || v === null || Number.isNaN(Number(v)) ? fallback : Number(v);

export function makeTrackingId() {
  const year = new Date().getFullYear();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `VER-${year}-${rand}`;
}

export function makeApplicationRef() {
  const year = new Date().getFullYear();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `APP-${year}-${rand}`;
}

// ---------------------------------------------------------------------------
// Final outcome vs AI verdict.
//
// verification_results.decision is what the ENGINE decided and never changes -
// it is the audit record of the automated verdict. pending_applications.status
// is what a human OFFICER later decided. The dashboard must show the officer's
// word when there is one, otherwise a title an admin rejected would sit on the
// applicant's screen saying "Manual Review" forever.
// ---------------------------------------------------------------------------
const FINAL_DECISION_SQL = `
  CASE
    WHEN p.status IN ('ACCEPTED','APPROVED') THEN 'ACCEPT'
    WHEN p.status = 'REJECTED'               THEN 'REJECT'
    ELSE v.decision
  END`;

const REVIEW_JOIN_SQL =
  'LEFT JOIN pending_applications p ON p.verification_id = v.id';

export const databaseService = {
  // =======================================================================
  // Users
  // =======================================================================
  async findUserByEmail(email) {
    if (!email) return null;
    const rows = await query(
      'SELECT * FROM users WHERE email = ? LIMIT 1',
      [String(email).trim().toLowerCase()]
    );
    return rows[0] || null;
  },

  async findUserById(id) {
    const rows = await query('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
  },

  async createUser({ id, username, email, mobile, organization, passwordHash,
                     role = 'Verified Official', verificationCode = null }) {
    await query(
      `INSERT INTO users (id, username, email, mobile, organization,
                          password_hash, role, is_verified, verification_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [id, username, String(email).trim().toLowerCase(), mobile || null,
       organization || null, passwordHash, role, verificationCode]
    );
    return this.findUserById(id);
  },

  async markEmailVerified(email) {
    await query(
      'UPDATE users SET is_verified = 1, verification_code = NULL WHERE email = ?',
      [String(email).trim().toLowerCase()]
    );
    return this.findUserByEmail(email);
  },

  async setUserVerified(id) {
    await query(
      'UPDATE users SET is_verified = 1, verification_code = NULL WHERE id = ? OR email = ?',
      [id, id]
    );
    return this.findUserById(id);
  },

  async setVerificationCode(email, code) {
    await query('UPDATE users SET verification_code = ? WHERE email = ?',
      [code, String(email).trim().toLowerCase()]);
    return code;
  },

  async touchLogin(id) {
    await query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [id]);
  },

  // =======================================================================
  // Verifications
  // =======================================================================
  /**
   * Persist a verification plus its matched-title evidence in one transaction,
   * so a half-written audit trail can never exist.
   */
  async saveVerification({ trackingId, userId, request, result }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [res] = await conn.execute(
        `INSERT INTO verification_results
           (tracking_id, user_id, submitted_title, normalized_title, language,
            publication_type, periodicity, publisher, publication_state,
            decision, similarity_score, verification_probability, confidence,
            explanation, explanation_source, findings, checks_passed,
            suggestions, agent_trace, engine, processing_ms)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          trackingId,
          userId || null,
          result.title,
          result.normalizedTitle,
          request.language || null,
          request.publicationType || null,
          request.periodicity || null,
          request.publisher || null,
          request.state || null,
          result.decision,
          num(result.similarityScore, 0),
          num(result.verificationProbability, 0),
          result.confidence || null,
          result.explanation || null,
          result.explanationSource || null,
          JSON.stringify(result.findings || []),
          JSON.stringify(result.checksPassed || []),
          JSON.stringify(result.suggestions || []),
          JSON.stringify(result.agentTrace || []),
          JSON.stringify(result.engine || {}),
          num(result.processingMs, null)
        ]
      );

      const verificationId = res.insertId;
      const matches = result.similarTitles || [];

      if (matches.length) {
        const values = matches.map((m, i) => [
          verificationId,
          i + 1,
          m.title,
          m.metadata?.registrationNumber || null,
          m.metadata?.publisher || null,
          m.metadata?.language || null,
          m.metadata?.state || null,
          m.metadata?.source || 'REGISTERED',
          num(m.similarity, 0),
          num(m.scores?.semantic, null),
          num(m.scores?.reranker, null),
          num(m.scores?.fuzzy, null),
          num(m.scores?.phonetic, null),
          num(m.scores?.token, null),
          (m.matchedVia || []).join(',')
        ]);

        await conn.query(
          `INSERT INTO verification_matches
             (verification_id, rank_position, matched_title, registration_number,
              publisher, language, publication_state, source, similarity,
              semantic_score, reranker_score, fuzzy_score, phonetic_score,
              token_score, matched_via)
           VALUES ?`,
          [values]
        );
      }

      await conn.commit();
      return { id: verificationId, trackingId };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async listVerifications({ userId = null, limit = 100, offset = 0,
                            decision = null, search = null } = {}) {
    const where = [];
    const params = [];

    if (userId) { where.push('v.user_id = ?'); params.push(userId); }
    if (search) {
      where.push('(v.submitted_title LIKE ? OR v.tracking_id LIKE ? OR v.publisher LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    // Filter on the FINAL outcome, so "Rejected" in the UI finds titles an
    // officer rejected as well as ones the engine rejected outright.
    if (decision && decision !== 'ALL') {
      where.push(`${FINAL_DECISION_SQL} = ?`);
      params.push(decision);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await query(
      `SELECT v.id, v.tracking_id, v.submitted_title, v.normalized_title,
              v.language, v.publication_type, v.publisher, v.decision,
              v.similarity_score, v.verification_probability, v.confidence,
              v.explanation, v.explanation_source, v.findings, v.suggestions,
              v.created_at,
              p.status        AS review_status,
              p.application_ref AS application_ref,
              p.reviewed_by   AS reviewed_by,
              p.reviewed_at   AS reviewed_at,
              p.review_reason AS review_reason,
              ${FINAL_DECISION_SQL} AS final_decision
       FROM verification_results v
       ${REVIEW_JOIN_SQL}
       ${clause}
       ORDER BY v.created_at DESC, v.id DESC
       LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params
    );

    const [{ total }] = await query(
      `SELECT COUNT(*) AS total FROM verification_results v ${REVIEW_JOIN_SQL} ${clause}`,
      params
    );

    return { rows: rows.map(mapVerificationRow), total: Number(total) };
  },

  async getVerification(trackingId, userId = null) {
    const params = [trackingId];
    let clause = 'WHERE v.tracking_id = ?';
    if (userId) { clause += ' AND v.user_id = ?'; params.push(userId); }

    const rows = await query(
      `SELECT v.*,
              p.status          AS review_status,
              p.application_ref AS application_ref,
              p.reviewed_by     AS reviewed_by,
              p.reviewed_at     AS reviewed_at,
              p.review_reason   AS review_reason,
              ${FINAL_DECISION_SQL} AS final_decision
       FROM verification_results v
       ${REVIEW_JOIN_SQL}
       ${clause} LIMIT 1`, params
    );
    if (!rows.length) return null;

    const record = rows[0];
    const matches = await query(
      `SELECT * FROM verification_matches
       WHERE verification_id = ? ORDER BY rank_position ASC`,
      [record.id]
    );

    return {
      ...mapVerificationRow(record),
      agentTrace: parseJson(record.agent_trace, []),
      checksPassed: parseJson(record.checks_passed, []),
      engine: parseJson(record.engine, {}),
      processingMs: record.processing_ms,
      similarTitles: matches.map((m) => ({
        title: m.matched_title,
        similarity: Number(m.similarity),
        otherRegistrations: 0,
        scores: {
          semantic: Number(m.semantic_score ?? 0),
          reranker: Number(m.reranker_score ?? 0),
          fuzzy: Number(m.fuzzy_score ?? 0),
          phonetic: Number(m.phonetic_score ?? 0),
          token: Number(m.token_score ?? 0)
        },
        matchedVia: (m.matched_via || '').split(',').filter(Boolean),
        metadata: {
          registrationNumber: m.registration_number,
          publisher: m.publisher,
          language: m.language,
          state: m.publication_state,
          source: m.source
        }
      }))
    };
  },

  // =======================================================================
  // Dashboard aggregates
  // =======================================================================
  async getStats(userId = null) {
    const clause = userId ? 'WHERE v.user_id = ?' : '';
    const params = userId ? [userId] : [];

    // Counted on the final outcome, not the engine's first verdict.
    const [totals] = await query(
      `SELECT
         COUNT(*)                                     AS total,
         SUM(${FINAL_DECISION_SQL} = 'ACCEPT')        AS accepted,
         SUM(${FINAL_DECISION_SQL} = 'REVIEW')        AS review,
         SUM(${FINAL_DECISION_SQL} = 'REJECT')        AS rejected,
         SUM(p.status IN ('ACCEPTED','APPROVED','REJECTED')) AS decidedByOfficer,
         COALESCE(AVG(v.similarity_score), 0)         AS avgSimilarity,
         COALESCE(AVG(v.verification_probability), 0) AS avgProbability
       FROM verification_results v ${REVIEW_JOIN_SQL} ${clause}`,
      params
    );

    const trend = await query(
      `SELECT DATE(v.created_at) AS day, COUNT(*) AS count
       FROM verification_results v
       ${clause ? `${clause} AND` : 'WHERE'} v.created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
       GROUP BY DATE(v.created_at) ORDER BY day ASC`,
      params
    );

    const recent = await query(
      `SELECT v.tracking_id, v.submitted_title, v.decision, v.similarity_score,
              v.verification_probability, v.created_at,
              p.status AS review_status, p.reviewed_by, p.review_reason,
              ${FINAL_DECISION_SQL} AS final_decision
       FROM verification_results v ${REVIEW_JOIN_SQL} ${clause}
       ORDER BY v.created_at DESC, v.id DESC LIMIT 6`,
      params
    );

    return {
      total: Number(totals.total || 0),
      accepted: Number(totals.accepted || 0),
      review: Number(totals.review || 0),
      rejected: Number(totals.rejected || 0),
      decidedByOfficer: Number(totals.decidedByOfficer || 0),
      avgSimilarity: Number(totals.avgSimilarity || 0),
      avgProbability: Number(totals.avgProbability || 0),
      trend: trend.map((t2) => ({ day: t2.day, count: Number(t2.count) })),
      recent: recent.map((r) => ({
        trackingId: r.tracking_id,
        title: r.submitted_title,
        decision: r.final_decision,
        aiDecision: r.decision,
        reviewStatus: r.review_status,
        reviewedBy: r.reviewed_by,
        reviewReason: r.review_reason,
        decidedByOfficer: ['ACCEPTED', 'APPROVED', 'REJECTED'].includes(r.review_status),
        similarityScore: Number(r.similarity_score),
        verificationProbability: Number(r.verification_probability),
        createdAt: r.created_at
      }))
    };
  },

  async getRegistrySize() {
    try {
      const [row] = await query('SELECT COUNT(*) AS total FROM prgi_titles');
      return Number(row.total || 0);
    } catch {
      return 0;
    }
  },

  // =======================================================================
  // =======================================================================
  // Pending applications & Admin Review  (requirement 5.b)
  // =======================================================================
  /**
   * Put an application into the queue.
   *
   * `status` matters:
   *   MANUAL_REVIEW - the AI landed in the 65-85% band and an officer must
   *                   accept or reject it. This is what fills the admin queue.
   *   PENDING       - the AI accepted it and the applicant asked to stake a
   *                   claim on the title.
   */
  async createPendingApplication({ applicationRef, userId, verificationId,
                                   title, normalizedTitle, language,
                                   periodicity, publisher, state,
                                   status = 'PENDING' }) {
    await query(
      `INSERT INTO pending_applications
         (application_ref, user_id, verification_id, title, normalized_title,
          language, periodicity, publisher, publication_state, status)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [applicationRef, userId || null, verificationId || null, title,
       normalizedTitle, language || null, periodicity || null,
       publisher || null, state || null, status]
    );
    return applicationRef;
  },

  /**
   * List applications for review with joined user, verification scores, and most similar title.
   */
  async listPendingApplications({ userId = null, includeDecided = false,
                                  status = null, search = null, limit = 200 } = {}) {
    const where = [];
    const params = [];

    if (userId) {
      where.push('p.user_id = ?');
      params.push(userId);
    }

    if (status && status !== 'ALL') {
      if (status === 'PENDING') {
        where.push("p.status IN ('PENDING')");
      } else if (status === 'MANUAL_REVIEW' || status === 'UNDER_REVIEW') {
        where.push("p.status IN ('MANUAL_REVIEW', 'UNDER_REVIEW')");
      } else if (status === 'ACCEPTED' || status === 'APPROVED') {
        where.push("p.status IN ('ACCEPTED', 'APPROVED')");
      } else if (status === 'REJECTED') {
        where.push("p.status = 'REJECTED'");
      } else {
        where.push('p.status = ?');
        params.push(status);
      }
    } else if (!includeDecided) {
      where.push("p.status IN ('PENDING','UNDER_REVIEW','MANUAL_REVIEW')");
    }

    if (search) {
      where.push('(p.title LIKE ? OR p.application_ref LIKE ? OR p.publisher LIKE ? OR u.username LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await query(
      `SELECT
         p.id,
         p.application_ref          AS applicationRef,
         p.user_id                  AS userId,
         p.verification_id          AS verificationId,
         p.title,
         p.normalized_title         AS normalizedTitle,
         p.language,
         p.periodicity,
         p.publisher,
         p.publication_state        AS publicationState,
         p.status,
         p.reviewed_by              AS reviewedBy,
         p.reviewed_at              AS reviewedAt,
         p.rejection_reason         AS rejectionReason,
         p.review_reason            AS reviewReason,
         p.submitted_at             AS submittedAt,
         p.decided_at               AS decidedAt,
         u.username                 AS submittedByName,
         u.email                    AS submittedByEmail,
         u.organization             AS submittedByOrg,
         v.tracking_id              AS trackingId,
         v.decision                 AS aiDecision,
         v.publication_type         AS publicationType,
         v.similarity_score         AS similarityScore,
         v.verification_probability AS verificationProbability,
         v.explanation              AS aiExplanation,
         (
           SELECT m.matched_title
           FROM verification_matches m
           WHERE m.verification_id = v.id
           ORDER BY m.rank_position ASC
           LIMIT 1
         ) AS mostSimilarTitle
       FROM pending_applications p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN verification_results v ON p.verification_id = v.id
       ${clause}
       ORDER BY p.submitted_at DESC
       LIMIT ${Number(limit)}`,
      params
    );

    return rows.map((r) => ({
      ...r,
      similarityScore: Number(r.similarityScore ?? 0),
      verificationProbability: Number(r.verificationProbability ?? 0),
      submittedByName: r.submittedByName || r.publisher || 'Applicant'
    }));
  },

  async getPendingApplicationByRef(applicationRef) {
    const rows = await query(
      `SELECT
         p.id,
         p.application_ref          AS applicationRef,
         p.user_id                  AS userId,
         p.verification_id          AS verificationId,
         p.title,
         p.normalized_title         AS normalizedTitle,
         p.language,
         p.periodicity,
         p.publisher,
         p.publication_state        AS publicationState,
         p.status,
         p.reviewed_by              AS reviewedBy,
         p.reviewed_at              AS reviewedAt,
         p.rejection_reason         AS rejectionReason,
         p.review_reason            AS reviewReason,
         p.submitted_at             AS submittedAt,
         p.decided_at               AS decidedAt,
         u.username                 AS submittedByName,
         u.email                    AS submittedByEmail,
         u.mobile                   AS submittedByMobile,
         u.organization             AS submittedByOrg,
         v.tracking_id              AS trackingId,
         v.decision                 AS aiDecision,
         v.publication_type         AS publicationType,
         v.similarity_score         AS similarityScore,
         v.verification_probability AS verificationProbability,
         v.explanation              AS aiExplanation,
         v.findings                 AS findings,
         v.checks_passed            AS checksPassed,
         v.suggestions              AS suggestions,
         v.agent_trace              AS agentTrace
       FROM pending_applications p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN verification_results v ON p.verification_id = v.id
       WHERE p.application_ref = ?
       LIMIT 1`,
      [applicationRef]
    );

    if (!rows.length) return null;
    const app = rows[0];

    let matches = [];
    if (app.verificationId) {
      matches = await query(
        `SELECT * FROM verification_matches
         WHERE verification_id = ? ORDER BY rank_position ASC`,
        [app.verificationId]
      );
    }

    return {
      ...app,
      similarityScore: Number(app.similarityScore ?? 0),
      verificationProbability: Number(app.verificationProbability ?? 0),
      submittedByName: app.submittedByName || app.publisher || 'Applicant',
      findings: parseJson(app.findings, []),
      checksPassed: parseJson(app.checksPassed, []),
      suggestions: parseJson(app.suggestions, []),
      agentTrace: parseJson(app.agentTrace, []),
      similarTitles: matches.map((m) => ({
        rank: m.rank_position,
        title: m.matched_title,
        similarity: Number(m.similarity),
        scores: {
          semantic: Number(m.semantic_score ?? 0),
          reranker: Number(m.reranker_score ?? 0),
          fuzzy: Number(m.fuzzy_score ?? 0),
          phonetic: Number(m.phonetic_score ?? 0),
          token: Number(m.token_score ?? 0)
        },
        matchedVia: (m.matched_via || '').split(',').filter(Boolean),
        metadata: {
          registrationNumber: m.registration_number,
          publisher: m.publisher,
          language: m.language,
          state: m.publication_state,
          source: m.source
        }
      }))
    };
  },

  async updatePendingStatus(applicationRef, status,
                            { reviewedBy = null, rejectionReason = null,
                              reason = null } = {}) {
    // One written justification, recorded whichever way the officer decides.
    const decisionReason = reason || rejectionReason || null;
    // Normalise status
    let dbStatus = status;
    if (status === 'ACCEPT') dbStatus = 'ACCEPTED';
    if (status === 'MANUAL_REVIEW') dbStatus = 'MANUAL_REVIEW';
    if (status === 'REJECT') dbStatus = 'REJECTED';

    await query(
      `UPDATE pending_applications
       SET
         status = ?,
         reviewed_by = COALESCE(?, reviewed_by),
         reviewed_at = NOW(),
         review_reason = ?,
         rejection_reason = CASE WHEN ? = 'REJECTED' THEN ? ELSE rejection_reason END,
         decided_at = CASE WHEN ? IN ('APPROVED','ACCEPTED','REJECTED','WITHDRAWN')
                           THEN NOW() ELSE decided_at END
       WHERE application_ref = ?`,
      [dbStatus, reviewedBy, decisionReason, dbStatus, decisionReason,
       dbStatus, applicationRef]
    );

    return { applicationRef, status: dbStatus, reviewedBy,
             reason: decisionReason, rejectionReason: decisionReason };
  },

  async getAdminStats() {
    try {
      const [pendingRow] = await query(
        "SELECT COUNT(*) AS count FROM pending_applications WHERE status IN ('PENDING','UNDER_REVIEW','MANUAL_REVIEW')"
      );
      // "Today" means today. These are labelled as daily figures in the UI,
      // so counting all time would be a lie on the dashboard.
      const [acceptedRow] = await query(
        "SELECT COUNT(*) AS count FROM pending_applications "
        + "WHERE status IN ('ACCEPTED','APPROVED') AND DATE(decided_at) = CURDATE()"
      );
      const [rejectedRow] = await query(
        "SELECT COUNT(*) AS count FROM pending_applications "
        + "WHERE status = 'REJECTED' AND DATE(decided_at) = CURDATE()"
      );
      const [totalRow] = await query(
        "SELECT COUNT(*) AS count FROM verification_results"
      );

      return {
        pendingReviews: Number(pendingRow?.count || 0),
        acceptedToday: Number(acceptedRow?.count || 0),
        rejectedToday: Number(rejectedRow?.count || 0),
        // No Math.max floor - an empty system honestly reports zero.
        totalRequests: Number(totalRow?.count || 0)
      };
    } catch (err) {
      console.error('[databaseService] getAdminStats error:', err);
      return {
        pendingReviews: 0,
        acceptedToday: 0,
        rejectedToday: 0,
        totalRequests: 0
      };
    }
  },

  // =======================================================================
  isConnected,
  checkConnection
};

// ---------------------------------------------------------------------------
function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapVerificationRow(row) {
  return {
    id: row.id,
    trackingId: row.tracking_id,
    title: row.submitted_title,
    normalizedTitle: row.normalized_title,
    language: row.language,
    publicationType: row.publication_type,
    publisher: row.publisher,
    // `decision` is the final outcome the UI should render; `aiDecision`
    // preserves what the engine originally said.
    decision: row.final_decision || row.decision,
    aiDecision: row.decision,
    reviewStatus: row.review_status || null,
    applicationRef: row.application_ref || null,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    reviewReason: row.review_reason || null,
    decidedByOfficer: ['ACCEPTED', 'APPROVED', 'REJECTED']
      .includes(row.review_status),
    similarityScore: Number(row.similarity_score),
    verificationProbability: Number(row.verification_probability),
    confidence: row.confidence,
    explanation: row.explanation,
    explanationSource: row.explanation_source,
    findings: parseJson(row.findings, []),
    suggestions: parseJson(row.suggestions, []),
    createdAt: row.created_at
  };
}

export default databaseService;
