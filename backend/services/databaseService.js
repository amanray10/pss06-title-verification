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

    if (userId) { where.push('user_id = ?'); params.push(userId); }
    if (decision && decision !== 'ALL') { where.push('decision = ?'); params.push(decision); }
    if (search) {
      where.push('(submitted_title LIKE ? OR tracking_id LIKE ? OR publisher LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await query(
      `SELECT id, tracking_id, submitted_title, normalized_title, language,
              publication_type, publisher, decision, similarity_score,
              verification_probability, confidence, explanation,
              explanation_source, findings, suggestions, created_at
       FROM verification_results
       ${clause}
       ORDER BY created_at DESC, id DESC
       LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params
    );

    const [{ total }] = await query(
      `SELECT COUNT(*) AS total FROM verification_results ${clause}`, params
    );

    return { rows: rows.map(mapVerificationRow), total: Number(total) };
  },

  async getVerification(trackingId, userId = null) {
    const params = [trackingId];
    let clause = 'WHERE tracking_id = ?';
    if (userId) { clause += ' AND user_id = ?'; params.push(userId); }

    const rows = await query(
      `SELECT * FROM verification_results ${clause} LIMIT 1`, params
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
    const clause = userId ? 'WHERE user_id = ?' : '';
    const params = userId ? [userId] : [];

    const [totals] = await query(
      `SELECT
         COUNT(*)                                          AS total,
         SUM(decision = 'ACCEPT')                          AS accepted,
         SUM(decision = 'REVIEW')                          AS review,
         SUM(decision = 'REJECT')                          AS rejected,
         COALESCE(AVG(similarity_score), 0)                AS avgSimilarity,
         COALESCE(AVG(verification_probability), 0)        AS avgProbability
       FROM verification_results ${clause}`,
      params
    );

    const trend = await query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS count
       FROM verification_results
       ${clause ? `${clause} AND` : 'WHERE'} created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
       GROUP BY DATE(created_at) ORDER BY day ASC`,
      params
    );

    const recent = await query(
      `SELECT tracking_id, submitted_title, decision, similarity_score,
              verification_probability, created_at
       FROM verification_results ${clause}
       ORDER BY created_at DESC, id DESC LIMIT 6`,
      params
    );

    return {
      total: Number(totals.total || 0),
      accepted: Number(totals.accepted || 0),
      review: Number(totals.review || 0),
      rejected: Number(totals.rejected || 0),
      avgSimilarity: Number(totals.avgSimilarity || 0),
      avgProbability: Number(totals.avgProbability || 0),
      trend: trend.map((t) => ({ day: t.day, count: Number(t.count) })),
      recent: recent.map((r) => ({
        trackingId: r.tracking_id,
        title: r.submitted_title,
        decision: r.decision,
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
  // Pending applications (requirement 5.b)
  // =======================================================================
  async createPendingApplication({ applicationRef, userId, verificationId,
                                   title, normalizedTitle, language,
                                   periodicity, publisher, state }) {
    await query(
      `INSERT INTO pending_applications
         (application_ref, user_id, verification_id, title, normalized_title,
          language, periodicity, publisher, publication_state, status)
       VALUES (?,?,?,?,?,?,?,?,?, 'PENDING')`,
      [applicationRef, userId || null, verificationId || null, title,
       normalizedTitle, language || null, periodicity || null,
       publisher || null, state || null]
    );
    return applicationRef;
  },

  /**
   * Only PENDING / UNDER_REVIEW rows are returned by default: those are the
   * ones that actually block a later applicant. Decided applications stay in
   * the table for the audit trail but no longer hold a claim on the title.
   */
  async listPendingApplications(userId = null, includeDecided = false) {
    const where = [];
    const params = [];
    if (userId) { where.push('user_id = ?'); params.push(userId); }
    if (!includeDecided) where.push("status IN ('PENDING','UNDER_REVIEW')");
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return query(
      `SELECT * FROM pending_applications ${clause}
       ORDER BY submitted_at DESC LIMIT 200`, params
    );
  },

  async updatePendingStatus(applicationRef, status) {
    await query(
      `UPDATE pending_applications
       SET status = ?, decided_at = CASE WHEN ? IN ('APPROVED','REJECTED','WITHDRAWN')
                                         THEN NOW() ELSE decided_at END
       WHERE application_ref = ?`,
      [status, status, applicationRef]
    );
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
    decision: row.decision,
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
