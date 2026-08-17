import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Shield,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Building2,
  FileText,
  User,
  Calendar,
  Globe,
  MapPin,
  Sparkles,
  Info,
  Check,
  AlertCircle,
  Loader2,
  ChevronRight,
  Gavel
} from 'lucide-react';
import AppShell from '../components/AppShell';
import { api } from '../api/client';

const SEVERITY = {
  BLOCKER: { cls: 'sev-blocker', label: 'Blocking', Icon: XCircle, color: '#dc2626', bg: '#fee2e2' },
  MAJOR: { cls: 'sev-major', label: 'Major', Icon: AlertTriangle, color: '#d97706', bg: '#fef3c7' },
  MINOR: { cls: 'sev-minor', label: 'Minor', Icon: Info, color: '#2563eb', bg: '#eff6ff' },
  INFO: { cls: 'sev-info', label: 'Note', Icon: Info, color: '#475569', bg: '#f1f5f9' }
};

const SIGNAL_LABELS = {
  semantic: 'Semantic (BGE-M3)',
  reranker: 'Cross-encoder',
  fuzzy: 'Spelling',
  phonetic: 'Phonetic',
  token: 'Word overlap'
};

const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric'
  }) : '-';

const fmtDateTime = (v) =>
  v ? new Date(v).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }) : '-';

export const AdminReview = ({ applicationRef, user, onNavigate, onLogout }) => {
  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Decision Modal State
  // The admin IS the manual reviewer, so there is no third destination to
  // send a title to. Two outcomes only, each needing a written reason.
  const [activeModal, setActiveModal] = useState(null); // 'ACCEPT' | 'REJECT' | null
  const [rejectionReason, setRejectionReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');

    if (!applicationRef) {
      setError('No application reference supplied. Open a title from the review queue.');
      setLoading(false);
      return () => { alive = false; };
    }

    api.adminPendingDetail(applicationRef)
      .then((data) => {
        if (!alive) return;
        if (data?.application) {
          setApplication(data.application);
        } else {
          setError(`No application found with reference ${applicationRef}.`);
        }
      })
      .catch((err) => {
        if (!alive) return;
        console.error('[AdminReview] load error:', err);
        setError(err.message || 'Unable to load application details.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
  }, [applicationRef]);

  const handleOpenModal = (decisionType) => {
    setActiveModal(decisionType);
    setRejectionReason('');
    setReasonError('');
  };

  const handleCloseModal = () => {
    if (submittingDecision) return;
    setActiveModal(null);
    setRejectionReason('');
    setReasonError('');
  };

  const handleConfirmDecision = async () => {
    // Both remaining outcomes are final decisions, so a written reason is
    // always required - the server rejects the request without one anyway.
    const trimmed = rejectionReason.trim();
    if (trimmed.length < 10) {
      setReasonError(
        activeModal === 'REJECT'
          ? 'State why this title is being rejected (at least 10 characters).'
          : 'State the grounds for accepting this title (at least 10 characters).'
      );
      return;
    }

    setSubmittingDecision(true);
    setReasonError('');

    try {
      const res = await api.adminUpdateDecision(applicationRef, {
        status: activeModal === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
        reason: trimmed
      });

      const message = activeModal === 'ACCEPT'
        ? 'Title accepted successfully.'
          : 'Title rejected successfully.';

      setToastMessage({ type: 'success', text: message });
      setActiveModal(null);

      // Return to dashboard after brief toast display
      setTimeout(() => {
        onNavigate?.('admin-dashboard');
      }, 1200);
    } catch (err) {
      console.error('[AdminReview] decision update failed:', err);
      setReasonError(err.message || 'Unable to update application status. Please try again.');
      setSubmittingDecision(false);
    }
  };

  if (loading) {
    return (
      <AppShell active="admin-dashboard" title="Review Publication Title" user={user} onNavigate={onNavigate} onLogout={onLogout}>
        <div style={{ maxWidth: 1000, margin: '60px auto', textAlign: 'center', color: '#64748b' }}>
          <Loader2 size={36} className="animate-spin" style={{ margin: '0 auto 16px auto', color: '#02529c' }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0c1e3d' }}>Loading Application Verification Evidence...</h3>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: 4 }}>Retrieving similarity signals, matches, and rule engine traces.</p>
        </div>
      </AppShell>
    );
  }

  if (error || !application) {
    return (
      <AppShell active="admin-dashboard" title="Review Publication Title" user={user} onNavigate={onNavigate} onLogout={onLogout}>
        <div style={{ maxWidth: 700, margin: '40px auto', padding: '32px', backgroundColor: '#ffffff', borderRadius: 14, border: '1px solid #e2e8f0', textAlign: 'center' }}>
          <AlertCircle size={40} color="#dc2626" style={{ margin: '0 auto 12px auto' }} />
          <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0c1e3d' }}>Application Not Found</h3>
          <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '8px auto 20px auto' }}>{error || 'Unable to load application details.'}</p>
          <button className="btn btn-primary" onClick={() => onNavigate?.('admin-dashboard')}>
            <ArrowLeft size={16} />
            <span>Return to Admin Dashboard</span>
          </button>
        </div>
      </AppShell>
    );
  }

  const score = Number(application.similarityScore || 0);
  const probability = Number(application.verificationProbability || 0);
  const findings = application.findings || [];
  const matches = application.similarTitles || [];
  const checksPassed = application.checksPassed || [];
  const suggestions = application.suggestions || [];
  const isAlreadyDecided = application.status === 'ACCEPTED' || application.status === 'APPROVED' || application.status === 'REJECTED';

  // AI Recommendation text based on AI decision
  const aiDecision = application.aiDecision || (score >= 85 ? 'REJECT' : score >= 65 ? 'REVIEW' : 'ACCEPT');
  const aiRecommendationText = aiDecision === 'ACCEPT'
    ? 'Acceptance Recommended (No blocking conflict)'
    : aiDecision === 'REJECT'
      ? 'Rejection Recommended (Statutory Conflict)'
      : 'Manual Review Recommended (Moderate Similarity)';

  const aiRecColor = aiDecision === 'ACCEPT' ? '#059669' : aiDecision === 'REJECT' ? '#dc2626' : '#d97706';
  const aiRecBg = aiDecision === 'ACCEPT' ? '#e6f9f0' : aiDecision === 'REJECT' ? '#fee2e2' : '#fef3c7';

  return (
    <AppShell
      active="admin-dashboard"
      title="Review Publication Title"
      user={user}
      onNavigate={onNavigate}
      onLogout={onLogout}
      topbarRight={
        <button
          className="btn btn-outline"
          style={{ fontSize: '0.82rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={() => onNavigate?.('admin-dashboard')}
        >
          <ArrowLeft size={15} />
          <span>Back to Dashboard</span>
        </button>
      }
    >
      <div className="admin-review-page" style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 60 }}>
        {/* Toast Notification */}
        {toastMessage && (
          <div style={{
            position: 'fixed',
            top: 24,
            right: 24,
            zIndex: 9999,
            backgroundColor: toastMessage.type === 'success' ? '#059669' : '#dc2626',
            color: '#ffffff',
            padding: '12px 20px',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: '0.9rem',
            fontWeight: 700
          }}>
            <CheckCircle2 size={20} />
            <span>{toastMessage.text}</span>
          </div>
        )}

        {/* Back Link Breadcrumb */}
        <div style={{ marginBottom: 16 }}>
          <button
            onClick={() => onNavigate?.('admin-dashboard')}
            style={{
              background: 'none',
              border: 'none',
              color: '#02529c',
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <ArrowLeft size={16} />
            <span>Back to Admin Dashboard</span>
          </button>
        </div>

        {/* Existing Review Status Banner if Already Reviewed */}
        {application.reviewedBy && (
          <div style={{
            backgroundColor: application.status === 'REJECTED' ? '#fee2e2' : '#e6f9f0',
            border: `1px solid ${application.status === 'REJECTED' ? '#fecaca' : '#a7f3d0'}`,
            borderRadius: 12,
            padding: '16px 20px',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12
          }}>
            {application.status === 'REJECTED' ? (
              <XCircle size={22} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
            ) : (
              <CheckCircle2 size={22} color="#059669" style={{ flexShrink: 0, marginTop: 2 }} />
            )}
            <div>
              <h4 style={{ fontSize: '0.92rem', fontWeight: 800, color: application.status === 'REJECTED' ? '#991b1b' : '#065f46' }}>
                Application Status: {application.status}
              </h4>
              <p style={{ fontSize: '0.82rem', color: application.status === 'REJECTED' ? '#b91c1c' : '#047857', marginTop: 2 }}>
                Reviewed by <strong>{application.reviewedBy}</strong> on {fmtDateTime(application.reviewedAt || application.decidedAt)}.
              </p>
              {(application.reviewReason || application.rejectionReason) && (
                <div style={{ marginTop: 8, padding: '8px 12px', backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 6, fontSize: '0.82rem', color: '#7f1d1d' }}>
                  <strong>Officer's reason:</strong>{' '}
                  {application.reviewReason || application.rejectionReason}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Header Hero Card: SECTION 1 PROPOSED TITLE & SECTION 2 APPLICANT */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: 16,
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 20px rgba(12, 30, 61, 0.06)',
          padding: '28px',
          marginBottom: 24
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
            <div>
              <span style={{
                fontSize: '0.74rem',
                fontWeight: 700,
                color: '#64748b',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                display: 'block',
                marginBottom: 6
              }}>
                Proposed Publication Title
              </span>
              <h1 style={{
                fontSize: '1.85rem',
                fontWeight: 800,
                color: '#0c1e3d',
                letterSpacing: '-0.02em',
                margin: 0
              }}>
                "{application.title}"
              </h1>
            </div>

            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>
                Reference ID
              </span>
              <span style={{
                fontSize: '0.92rem',
                fontWeight: 800,
                fontFamily: 'monospace',
                backgroundColor: '#f1f5f9',
                padding: '4px 10px',
                borderRadius: 6,
                color: '#0a254c'
              }}>
                {application.applicationRef}
              </span>
            </div>
          </div>

          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {/* Applicant */}
            <div>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#8492a6', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5 }}>
                <User size={13} /> Submitted By
              </span>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#1e293b', marginTop: 3 }}>
                {application.submittedByName}
              </div>
              {application.submittedByOrg && (
                <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  {application.submittedByOrg}
                </div>
              )}
              {application.submittedByEmail && (
                <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: 1 }}>
                  {application.submittedByEmail}
                </div>
              )}
            </div>

            {/* Language & Publication Type */}
            <div>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#8492a6', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Globe size={13} /> Language &amp; Type
              </span>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#1e293b', marginTop: 3 }}>
                {application.language || 'English'}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                {application.publicationType || 'Newspaper'} &bull; {application.periodicity || 'Daily'}
              </div>
            </div>

            {/* State / Region */}
            <div>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#8492a6', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5 }}>
                <MapPin size={13} /> Jurisdiction / State
              </span>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#1e293b', marginTop: 3 }}>
                {application.publicationState || 'National / All India'}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                PRGI Regional Register
              </div>
            </div>

            {/* Submission Date */}
            <div>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#8492a6', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Calendar size={13} /> Submission Date
              </span>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#1e293b', marginTop: 3 }}>
                {fmtDate(application.submittedAt)}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                {fmtDateTime(application.submittedAt)}
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 4 — AI VERIFICATION EVIDENCE */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: 16,
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 20px rgba(12, 30, 61, 0.06)',
          padding: '28px',
          marginBottom: 24
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, borderBottom: '1px solid #f1f5f9', paddingBottom: 16 }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: '#eaf2fc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#02529c'
            }}>
              <Sparkles size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0c1e3d', margin: 0 }}>
                AI Verification Evidence
              </h3>
              <p style={{ fontSize: '0.82rem', color: '#64748b', margin: 0 }}>
                Objective similarity metrics computed across 160,000+ registered publication titles.
              </p>
            </div>
          </div>

          {/* Scores Row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
            marginBottom: 24
          }}>
            {/* AI Similarity Score */}
            <div style={{
              backgroundColor: '#f8fafc',
              borderRadius: 12,
              padding: '20px',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  AI Similarity Score
                </span>
                <div style={{ fontSize: '2rem', fontWeight: 900, color: score >= 85 ? '#dc2626' : score >= 65 ? '#d97706' : '#059669', lineHeight: 1.1, marginTop: 4 }}>
                  {score.toFixed(0)}%
                </div>
                <span style={{ fontSize: '0.74rem', color: '#8492a6' }}>
                  Weighted fusion across 5 signals
                </span>
              </div>

              {/* Mini circular indicator */}
              <div style={{ width: 56, height: 56, borderRadius: '50%', border: `4px solid ${score >= 85 ? '#dc2626' : score >= 65 ? '#d97706' : '#059669'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.82rem', color: '#334155' }}>
                {score.toFixed(0)}%
              </div>
            </div>

            {/* Verification Probability */}
            <div style={{
              backgroundColor: '#f8fafc',
              borderRadius: 12,
              padding: '20px',
              border: '1px solid #e2e8f0'
            }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Verification Probability
              </span>
              <div style={{ fontSize: '2rem', fontWeight: 900, color: '#0a254c', lineHeight: 1.1, marginTop: 4 }}>
                {probability.toFixed(0)}%
              </div>
              <span style={{ fontSize: '0.74rem', color: '#8492a6' }}>
                Probability of title conflict under Section 6 PRGI Act
              </span>
            </div>

            {/* AI Recommendation */}
            <div style={{
              backgroundColor: aiRecBg,
              borderRadius: 12,
              padding: '20px',
              border: `1px solid ${aiRecColor}40`
            }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: aiRecColor, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                AI Recommendation
              </span>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: aiRecColor, marginTop: 4 }}>
                {aiRecommendationText}
              </div>
              <span style={{ fontSize: '0.74rem', color: '#475569', marginTop: 4, display: 'block' }}>
                Recommendation provided as decision support for the officer.
              </span>
            </div>
          </div>

          {/* MOST SIMILAR REGISTERED TITLES */}
          <div style={{ marginTop: 28 }}>
            <h4 style={{ fontSize: '1rem', fontWeight: 800, color: '#0c1e3d', marginBottom: 12 }}>
              Most Similar Registered Titles
            </h4>

            {matches.length === 0 ? (
              <div style={{ padding: '24px', backgroundColor: '#f8fafc', borderRadius: 10, textAlign: 'center', color: '#64748b', fontSize: '0.86rem' }}>
                No conflicting registered publication titles detected above threshold.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {matches.map((m, idx) => {
                  const mScore = Number(m.similarity || 0);
                  const mColor = mScore >= 85 ? '#dc2626' : mScore >= 65 ? '#d97706' : '#059669';

                  return (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: 12,
                        padding: '16px 20px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 14,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 260 }}>
                        <div style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          backgroundColor: '#f1f5f9',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 800,
                          fontSize: '0.85rem',
                          color: '#475569',
                          flexShrink: 0
                        }}>
                          {idx + 1}
                        </div>

                        <div>
                          <div style={{ fontSize: '1.02rem', fontWeight: 700, color: '#0c1e3d' }}>
                            {m.title}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {m.metadata?.registrationNumber && (
                              <span>Reg: <strong>{m.metadata.registrationNumber}</strong></span>
                            )}
                            {m.metadata?.publisher && (
                              <span>&bull; Publisher: {m.metadata.publisher}</span>
                            )}
                            {m.metadata?.state && (
                              <span>&bull; State: {m.metadata.state}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Similarity Score & Signal Breakdown */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        {/* Signal Tags */}
                        {m.scores && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {m.scores.semantic > 0 && (
                              <span style={{ fontSize: '0.7rem', padding: '2px 8px', backgroundColor: '#eaf2fc', color: '#02529c', borderRadius: 4, fontWeight: 600 }}>
                                Semantic: {(m.scores.semantic * 100).toFixed(0)}%
                              </span>
                            )}
                            {m.scores.reranker > 0 && (
                              <span style={{ fontSize: '0.7rem', padding: '2px 8px', backgroundColor: '#f3e8ff', color: '#7e22ce', borderRadius: 4, fontWeight: 600 }}>
                                Rerank: {(m.scores.reranker * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        )}

                        <div style={{
                          textAlign: 'right',
                          padding: '6px 14px',
                          backgroundColor: `${mColor}10`,
                          borderRadius: 8,
                          border: `1px solid ${mColor}30`
                        }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', display: 'block' }}>
                            Similarity
                          </span>
                          <span style={{ fontSize: '1.15rem', fontWeight: 900, color: mColor }}>
                            {mScore.toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* SECTION 5 — RULES & RECOMMENDATION */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: 16,
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 20px rgba(12, 30, 61, 0.06)',
          padding: '28px',
          marginBottom: 24
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, borderBottom: '1px solid #f1f5f9', paddingBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b45309' }}>
              <FileText size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0c1e3d', margin: 0 }}>
                Statutory Rule Findings &amp; Legal Justification
              </h3>
              <p style={{ fontSize: '0.82rem', color: '#64748b', margin: 0 }}>
                Automated compliance verification against the 15 statutory PRGI guidelines.
              </p>
            </div>
          </div>

          {/* Legal Explanation */}
          {application.aiExplanation && (
            <div style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: '18px 20px',
              marginBottom: 20
            }}>
              <h5 style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                Statutory Legal Analysis
              </h5>
              <p style={{ fontSize: '0.88rem', color: '#1e293b', lineHeight: 1.6, margin: 0 }}>
                {application.aiExplanation}
              </p>
            </div>
          )}

          {/* Rule Findings */}
          {findings.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <h5 style={{ fontSize: '0.84rem', fontWeight: 800, color: '#0c1e3d', marginBottom: 10 }}>
                Triggered Rule Findings ({findings.length})
              </h5>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {findings.map((f, i) => {
                  const s = SEVERITY[f.severity] || SEVERITY.MAJOR;
                  const SevIcon = s.Icon;

                  return (
                    <div
                      key={i}
                      style={{
                        padding: '14px 18px',
                        borderRadius: 10,
                        backgroundColor: s.bg,
                        border: `1px solid ${s.color}35`,
                        display: 'flex',
                        gap: 12,
                        alignItems: 'flex-start'
                      }}
                    >
                      <SevIcon size={18} color={s.color} style={{ flexShrink: 0, marginTop: 2 }} />
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 800, color: s.color, textTransform: 'uppercase' }}>
                            {f.ruleId ? `${f.ruleId}: ` : ''}{f.ruleName || 'Rule Triggered'}
                          </span>
                          <span style={{ fontSize: '0.68rem', padding: '1px 6px', backgroundColor: `${s.color}20`, color: s.color, borderRadius: 4, fontWeight: 700 }}>
                            {s.label}
                          </span>
                        </div>
                        <p style={{ fontSize: '0.84rem', color: '#1e293b', margin: '4px 0 0 0', lineHeight: 1.4 }}>
                          {f.message}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Checks Passed */}
          {checksPassed.length > 0 && (
            <div>
              <h5 style={{ fontSize: '0.84rem', fontWeight: 800, color: '#0c1e3d', marginBottom: 10 }}>
                Statutory Checks Passed ({checksPassed.length})
              </h5>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
                {checksPassed.map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', backgroundColor: '#e6f9f0', borderRadius: 8, fontSize: '0.8rem', color: '#065f46', fontWeight: 600 }}>
                    <Check size={14} color="#059669" strokeWidth={3} />
                    <span>{typeof c === 'string' ? c : c.ruleName || c.ruleId}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* SECTION 6 — ADMINISTRATOR DECISION (STICKY / PROMINENT FOOTER) */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: 16,
          border: '2px solid #02529c',
          boxShadow: '0 8px 30px rgba(2, 82, 156, 0.12)',
          padding: '28px',
          textAlign: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
            <Gavel size={22} color="#02529c" />
            <h3 style={{ fontSize: '1.35rem', fontWeight: 900, color: '#0c1e3d', margin: 0 }}>
              Administrator Decision
            </h3>
          </div>
          <p style={{ fontSize: '0.88rem', color: '#64748b', maxWidth: 600, margin: '0 auto 24px auto' }}>
            The AI system provides decision support. As the authorized PRGI administrator, select the final statutory verdict for this publication title.
          </p>

          {/* 3 Visually Distinct Action Buttons */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap'
          }}>
            {/* Button 1: Accept Title */}
            <button
              className="btn btn-success"
              style={{
                backgroundColor: '#059669',
                color: '#ffffff',
                border: 'none',
                padding: '14px 28px',
                borderRadius: 12,
                fontSize: '0.95rem',
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 4px 14px rgba(5, 150, 105, 0.35)',
                cursor: 'pointer',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease'
              }}
              onClick={() => handleOpenModal('ACCEPT')}
            >
              <CheckCircle2 size={18} strokeWidth={2.5} />
              <span>✓ ACCEPT TITLE</span>
            </button>

            {/* Button 2: Reject Title */}
            <button
              className="btn btn-danger"
              style={{
                backgroundColor: '#dc2626',
                color: '#ffffff',
                border: 'none',
                padding: '14px 28px',
                borderRadius: 12,
                fontSize: '0.95rem',
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 4px 14px rgba(220, 38, 38, 0.35)',
                cursor: 'pointer'
              }}
              onClick={() => handleOpenModal('REJECT')}
            >
              <XCircle size={18} strokeWidth={2.5} />
              <span>✕ REJECT TITLE</span>
            </button>
          </div>
        </div>

        {/* CONFIRMATION / DECISION MODALS */}
        {activeModal && (
          <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9990,
            backgroundColor: 'rgba(5, 26, 54, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20
          }}>
            <div style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              maxWidth: 500,
              width: '100%',
              padding: '28px',
              boxShadow: '0 20px 48px rgba(0,0,0,0.25)',
              border: '1px solid #e2e8f0',
              animation: 'fadeIn 0.2s ease-out'
            }}>
              {/* Modal Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: activeModal === 'ACCEPT' ? '#e6f9f0' : '#fee2e2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: activeModal === 'ACCEPT' ? '#059669' : '#dc2626'
                }}>
                  {activeModal === 'ACCEPT' && <CheckCircle2 size={24} />}
                  {activeModal === 'REJECT' && <XCircle size={24} />}
                </div>

                <div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0c1e3d', margin: 0 }}>
                    {activeModal === 'ACCEPT' && 'Accept this publication title?'}
                    {activeModal === 'REJECT' && 'Reject this publication title?'}
                  </h3>
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Title: <strong>"{application.title}"</strong>
                  </span>
                </div>
              </div>

              {/* Modal Body */}
              <div style={{ marginBottom: 24 }}>
                {activeModal === 'ACCEPT' && (
                  <p style={{ fontSize: '0.88rem', color: '#475569', lineHeight: 1.5, margin: 0 }}>
                    Are you sure you want to approve this title? Approving will update the official application record to <strong>ACCEPTED</strong> and register the title under the Press Registrar General of India registry.
                  </p>
                )}

                <div>
                    <p style={{ fontSize: '0.88rem', color: '#475569', lineHeight: 1.5, marginBottom: 12 }}>
                      {activeModal === 'REJECT'
                        ? 'Please provide a formal statutory justification for rejecting this publication title.'
                        : 'Please state the grounds on which you are overriding the moderate-similarity recommendation and accepting this title.'}
                      {' '}This reason is recorded in the official audit trail against your name.
                    </p>

                    <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: 6 }}>
                      {activeModal === 'REJECT'
                        ? 'Reason for rejection'
                        : 'Grounds for acceptance'}{' '}
                      <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <textarea
                      placeholder={activeModal === 'REJECT'
                        ? "e.g. Differs from the registered title 'Agra Bharat' only by the generic suffix Patrika; not sufficiently distinctive under Section 2.a."
                        : "e.g. The shared words are generic registry terms; the distinctive element and the district of publication are different."}
                      value={rejectionReason}
                      onChange={(e) => {
                        setRejectionReason(e.target.value);
                        setReasonError('');
                      }}
                      rows={4}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: `1px solid ${reasonError ? '#dc2626' : '#cbd5e1'}`,
                        fontSize: '0.86rem',
                        color: '#0c1e3d',
                        fontFamily: 'inherit',
                        resize: 'vertical'
                      }}
                      required
                    />
                </div>

                {/* Error Banner */}
                {reasonError && (
                  <div style={{ marginTop: 12, padding: '8px 12px', backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertCircle size={14} />
                    <span>{reasonError}</span>
                  </div>
                )}
              </div>

              {/* Modal Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={handleCloseModal}
                  disabled={submittingDecision}
                  style={{ padding: '8px 18px', fontSize: '0.88rem', fontWeight: 600 }}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  style={{
                    backgroundColor: activeModal === 'ACCEPT' ? '#059669' : '#dc2626',
                    color: '#ffffff',
                    border: 'none',
                    padding: '8px 20px',
                    borderRadius: 8,
                    fontSize: '0.88rem',
                    fontWeight: 700,
                    cursor: submittingDecision ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                  onClick={handleConfirmDecision}
                  disabled={submittingDecision}
                >
                  {submittingDecision ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      <span>Saving Decision...</span>
                    </>
                  ) : (
                    <>
                      {activeModal === 'ACCEPT' && 'Confirm Accept'}
                      {activeModal === 'REJECT' && 'Confirm Rejection'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default AdminReview;
