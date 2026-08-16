import React, { useState } from 'react';
import {
  Search,
  AlertTriangle,
  ArrowLeft,
  SearchCheck,
  Building2,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Info,
  Sparkles,
  ListChecks,
  Workflow,
  Copy,
  Loader2,
  Gavel
} from 'lucide-react';
import AppShell from '../components/AppShell';
import { api } from '../api/client';

const DECISION = {
  ACCEPT: {
    label: 'TITLE ACCEPTED',
    pill: 'gov-pill-accept',
    heading: 'No blocking conflict found',
    arc: '#059669',
    Icon: CheckCircle2
  },
  REVIEW: {
    label: 'MANUAL REVIEW REQUIRED',
    pill: 'gov-pill-review',
    heading: 'Similarity requires an officer to look',
    arc: '#d97706',
    Icon: AlertTriangle
  },
  REJECT: {
    label: 'TITLE REJECTED',
    pill: 'gov-pill-reject',
    heading: 'Conflicts with the existing register',
    arc: '#dc2626',
    Icon: XCircle
  }
};

const SEVERITY = {
  BLOCKER: { cls: 'sev-blocker', label: 'Blocking', Icon: XCircle },
  MAJOR: { cls: 'sev-major', label: 'Major', Icon: AlertTriangle },
  MINOR: { cls: 'sev-minor', label: 'Minor', Icon: Info },
  INFO: { cls: 'sev-info', label: 'Note', Icon: Info }
};

const SIGNAL_LABELS = {
  semantic: 'Semantic (BGE-M3)',
  reranker: 'Cross-encoder',
  fuzzy: 'Spelling',
  phonetic: 'Phonetic',
  token: 'Word overlap',
  coreOverlap: 'Core overlap',
  conceptOverlap: 'Meaning overlap'
};

export const VerificationResult = ({ verification, user, onNavigate, onLogout, onReverify }) => {
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('evidence');
  const [editTitle, setEditTitle] = useState(verification?.title || '');
  const [resubmitting, setResubmitting] = useState(false);
  const [resubmitError, setResubmitError] = useState('');

  if (!verification) {
    return (
      <AppShell active="new" user={user} onNavigate={onNavigate} onLogout={onLogout}>
        <div className="gov-empty-state" style={{ padding: '80px 20px' }}>
          <SearchCheck size={32} />
          <p>No verification selected.</p>
          <button className="btn btn-primary" onClick={() => onNavigate('dashboard')}>
            Check a title
          </button>
        </div>
      </AppShell>
    );
  }

  const decision = DECISION[verification.decision] || DECISION.REVIEW;
  const similarity = Number(verification.similarityScore || 0);
  const probability = Number(verification.verificationProbability || 0);
  const findings = verification.findings || [];
  const matches = verification.similarTitles || [];
  const trace = verification.agentTrace || [];
  const passed = verification.checksPassed || [];
  const suggestions = verification.suggestions || [];

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (circumference * Math.min(similarity, 100)) / 100;

  const handleResubmit = async (e) => {
    e.preventDefault();
    const title = editTitle.trim();
    if (!title) return;
    setResubmitError('');
    setResubmitting(true);
    try {
      const data = await api.verifyTitle({
        title,
        language: verification.language || 'English',
        publicationType: verification.publicationType || 'Newspaper'
      });
      onReverify?.({
        ...data.result,
        trackingId: data.trackingId,
        applicationRef: data.applicationRef,
        persisted: data.persisted
      });
      setTab('evidence');
    } catch (err) {
      setResubmitError(err.message);
    } finally {
      setResubmitting(false);
    }
  };

  return (
    <AppShell
      active="new"
      title="Verification Result"
      user={user}
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      <div className="gov-breadcrumb">
        <span className="breadcrumb-link" onClick={() => onNavigate('dashboard')}>
          Verifications
        </span>
        <ChevronRight size={14} className="breadcrumb-separator" />
        <span className="breadcrumb-current">Result</span>
      </div>

      <div className="gov-result-header">
        <h2 className="gov-result-main-title">Verification Result</h2>
        <div className="gov-result-tag-row">
          <span className="gov-target-title-text">&ldquo;{verification.title}&rdquo;</span>
          {verification.language && (
            <span className="gov-badge-lang">{String(verification.language).toUpperCase()}</span>
          )}
          {verification.trackingId && (
            <span className="gov-badge-tracking" title="Tracking ID"
                  onClick={() => navigator.clipboard?.writeText(verification.trackingId)}>
              <Copy size={11} /> {verification.trackingId}
            </span>
          )}
          {verification.applicationRef && (
            <span className="gov-badge-pending">
              Queued as {verification.applicationRef}
            </span>
          )}
        </div>
        {verification.normalizedTitle && (
          <p className="gov-normalized-line">
            Normalised for matching: <code>{verification.normalizedTitle}</code>
          </p>
        )}
      </div>

      <div className="gov-result-grid">
        {/* ------------------------------------------------------ left column */}
        <div className="gov-result-card-container">
          <div className="gov-result-gauge-card">
            <div className={`gov-pill-review ${decision.pill}`}>
              <decision.Icon size={15} />
              <span>{decision.label}</span>
            </div>

            <div className="gov-gauge-wrapper">
              <svg className="gov-gauge-svg" width="140" height="140" viewBox="0 0 140 140">
                <circle className="gauge-bg-track" cx="70" cy="70" r={radius} strokeWidth="12" />
                <circle
                  className="gauge-progress-arc"
                  cx="70" cy="70" r={radius} strokeWidth="12"
                  style={{ stroke: decision.arc }}
                  strokeDasharray={circumference}
                  strokeDashoffset={offset}
                  transform="rotate(-90 70 70)"
                />
              </svg>
              <div className="gov-gauge-number-center">
                <span className="gauge-score-value">{similarity.toFixed(0)}%</span>
                <span className="gauge-score-caption">similarity</span>
              </div>
            </div>

            <h3 className="gov-gauge-heading">{decision.heading}</h3>

            <div className="gov-probability-block">
              <div className="gov-prob-row">
                <span>Verification probability</span>
                <strong>{probability.toFixed(1)}%</strong>
              </div>
              <div className="gov-progress-track tall">
                <div
                  className={`gov-progress-fill ${probability >= 60 ? 'progress-green'
                    : probability >= 30 ? 'progress-orange' : 'progress-red'}`}
                  style={{ width: `${Math.min(probability, 100)}%` }}
                />
              </div>
              <p className="gov-prob-note">
                A title that is {similarity.toFixed(0)}% similar to an existing one
                cannot exceed {(100 - similarity).toFixed(0)}% likelihood of
                verification; guideline violations reduce it further.
              </p>
            </div>

            <div className="gov-confidence-row">
              <span>System confidence</span>
              <span className={`gov-conf-chip conf-${(verification.confidence || 'MEDIUM').toLowerCase()}`}>
                {verification.confidence || 'MEDIUM'}
              </span>
            </div>
          </div>

          {/* explanation */}
          <div className="gov-explanation-card">
            <div className="gov-card-head">
              <Sparkles size={16} color="#02529c" />
              <h4>Explanation</h4>
              <span className="gov-source-chip">
                {verification.explanationSource === 'template'
                  ? 'rule-derived'
                  : verification.explanationSource || 'generated'}
              </span>
            </div>
            <p className="gov-explanation-text">{verification.explanation}</p>
          </div>

          <div className="gov-result-actions">
            <button type="button" className="btn btn-primary btn-full"
                    onClick={() => onNavigate('dashboard')}
                    style={{ padding: '12px 18px', fontSize: '0.92rem', gap: '8px' }}>
              <Search size={16} />
              <span>Check Another Title</span>
            </button>
            <button type="button" className="btn btn-outline btn-full"
                    onClick={() => onNavigate('my-verifications')}
                    style={{ padding: '12px 18px', fontSize: '0.92rem', gap: '8px' }}>
              <ArrowLeft size={16} />
              <span>Back to History</span>
            </button>
          </div>
        </div>

        {/* ----------------------------------------------------- right column */}
        <div className="gov-similar-panel">
          <div className="gov-tab-bar">
            <button className={`gov-tab ${tab === 'evidence' ? 'active' : ''}`}
                    onClick={() => setTab('evidence')}>
              <SearchCheck size={15} /> Matches ({matches.length})
            </button>
            <button className={`gov-tab ${tab === 'rules' ? 'active' : ''}`}
                    onClick={() => setTab('rules')}>
              <Gavel size={15} /> Rules ({findings.length})
            </button>
            <button className={`gov-tab ${tab === 'trace' ? 'active' : ''}`}
                    onClick={() => setTab('trace')}>
              <Workflow size={15} /> Agent
            </button>
            <button className={`gov-tab ${tab === 'fix' ? 'active' : ''}`}
                    onClick={() => setTab('fix')}>
              <ListChecks size={15} /> Fix &amp; Resubmit
            </button>
          </div>

          {/* ---- matches ---- */}
          {tab === 'evidence' && (
            <div className="gov-similar-list">
              {matches.length === 0 && (
                <div className="gov-empty-state">
                  <SearchCheck size={24} />
                  <p>No comparable title found in the register.</p>
                </div>
              )}
              {matches.map((item, i) => (
                <div key={`${item.title}-${i}`} className="gov-similar-card">
                  <div className="gov-similar-card-info">
                    <div className="gov-similar-title-row">
                      <span className="gov-matched-title">&ldquo;{item.title}&rdquo;</span>
                      <span className={`gov-badge-match ${item.similarity >= 85 ? 'high'
                        : item.similarity >= 65 ? 'mid' : 'low'}`}>
                        {Number(item.similarity).toFixed(0)}% Match
                      </span>
                      {item.metadata?.source === 'PENDING' && (
                        <span className="gov-badge-pending">In queue</span>
                      )}
                    </div>

                    <div className="gov-matched-meta-row">
                      <span className="gov-meta-publisher">
                        <Building2 size={13} /> {item.metadata?.publisher || 'Publisher not recorded'}
                      </span>
                      <span className="gov-meta-dot">&bull;</span>
                      <span className="gov-meta-reg">
                        Reg: {item.metadata?.registrationNumber || 'n/a'}
                      </span>
                      {item.metadata?.language && (
                        <>
                          <span className="gov-meta-dot">&bull;</span>
                          <span className="gov-meta-reg">{item.metadata.language}</span>
                        </>
                      )}
                    </div>

                    <div className="gov-chip-row">
                      {(item.matchedVia || []).map((c) => (
                        <span key={c} className="gov-channel-chip">{c}</span>
                      ))}
                      {item.otherRegistrations > 0 && (
                        <span className="gov-channel-chip muted">
                          +{item.otherRegistrations} other registration
                          {item.otherRegistrations > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  <button type="button" className="btn btn-outline btn-sm gov-btn-details"
                          onClick={() => setSelected(item)}>
                    Score breakdown
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ---- rules ---- */}
          {tab === 'rules' && (
            <div className="gov-rules-list">
              {findings.length === 0 ? (
                <div className="gov-all-clear">
                  <CheckCircle2 size={22} color="#059669" />
                  <div>
                    <strong>No guideline violation detected.</strong>
                    <p>Every deterministic check below passed.</p>
                  </div>
                </div>
              ) : (
                findings.map((f) => {
                  const sev = SEVERITY[f.severity] || SEVERITY.INFO;
                  return (
                    <div key={`${f.code}-${f.rule}`} className={`gov-finding-card ${sev.cls}`}>
                      <div className="gov-finding-head">
                        <sev.Icon size={15} />
                        <span className="gov-finding-rule">{f.code} &middot; {f.rule}</span>
                        <span className="gov-finding-sev">{sev.label}</span>
                        {f.requirement && (
                          <span className="gov-finding-req">req {f.requirement}</span>
                        )}
                      </div>
                      <p className="gov-finding-msg">{f.message}</p>
                      {f.evidence && Object.keys(f.evidence).length > 0 && (
                        <details className="gov-evidence">
                          <summary>Evidence</summary>
                          <pre>{JSON.stringify(f.evidence, null, 2)}</pre>
                        </details>
                      )}
                    </div>
                  );
                })
              )}

              {passed.length > 0 && (
                <div className="gov-passed-block">
                  <h5>Checks passed</h5>
                  <ul>
                    {passed.map((p) => (
                      <li key={p}><CheckCircle2 size={13} color="#059669" /> {p}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ---- agent trace ---- */}
          {tab === 'trace' && (
            <div className="gov-trace-list">
              {trace.length === 0 && (
                <div className="gov-empty-state">
                  <Workflow size={22} />
                  <p>No trace recorded for this verification.</p>
                </div>
              )}
              {trace.map((step) => (
                <div key={step.step} className="gov-trace-step">
                  <div className="gov-trace-index">{step.step}</div>
                  <div className="gov-trace-body">
                    <div className="gov-trace-tool">
                      {step.tool}
                      <span className="gov-trace-ms">{Number(step.durationMs).toFixed(1)} ms</span>
                    </div>
                    <p className="gov-trace-summary">{step.summary}</p>
                  </div>
                </div>
              ))}
              {verification.processingMs && (
                <div className="gov-trace-total">
                  Total pipeline time: {Number(verification.processingMs).toFixed(0)} ms
                </div>
              )}
            </div>
          )}

          {/* ---- fix and resubmit ---- */}
          {tab === 'fix' && (
            <div className="gov-fix-panel">
              <h4 className="gov-fix-heading">Recommended changes</h4>
              <ul className="gov-suggestion-list">
                {suggestions.map((sug, i) => (
                  <li key={i}><ChevronRight size={14} /> {sug}</li>
                ))}
              </ul>

              <form onSubmit={handleResubmit} className="gov-resubmit-form">
                <label className="gov-input-label" htmlFor="revised-title">
                  Revise the title and check again
                </label>
                <div className="gov-search-input-wrap">
                  <Search size={16} className="gov-search-icon-inside" />
                  <input
                    id="revised-title"
                    className="gov-title-text-input"
                    value={editTitle}
                    maxLength={300}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="Enter the revised publication title"
                  />
                </div>
                {resubmitError && (
                  <div className="gov-form-error">
                    <XCircle size={15} /><span>{resubmitError}</span>
                  </div>
                )}
                <button type="submit" className="btn btn-primary" disabled={resubmitting}>
                  {resubmitting ? <Loader2 size={16} className="spin" /> : <Shield16 />}
                  <span>{resubmitting ? 'Re-checking...' : 'Verify Revised Title'}</span>
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* score breakdown modal */}
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-bar">
              <h3 className="modal-heading">Match Breakdown</h3>
              <button className="modal-btn-close" onClick={() => setSelected(null)}>&times;</button>
            </div>
            <div className="modal-form-body">
              <div className="gov-modal-title-row">
                <h4>&ldquo;{selected.title}&rdquo;</h4>
                <span className="gov-badge-match high">
                  {Number(selected.similarity).toFixed(1)}% combined
                </span>
              </div>

              <div className="gov-signal-grid">
                {Object.entries(selected.scores || {}).map(([key, value]) => (
                  <div key={key} className="gov-signal-row">
                    <span className="gov-signal-name">{SIGNAL_LABELS[key] || key}</span>
                    <div className="gov-progress-track">
                      <div className="gov-progress-fill progress-blue"
                           style={{ width: `${Math.min(Number(value) * 100, 100)}%` }} />
                    </div>
                    <span className="gov-signal-value">
                      {(Number(value) * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>

              <div className="gov-modal-meta">
                <p>Registration: <strong>{selected.metadata?.registrationNumber || 'n/a'}</strong></p>
                <p>Publisher: <strong>{selected.metadata?.publisher || 'n/a'}</strong></p>
                <p>Owner: <strong>{selected.metadata?.owner || 'n/a'}</strong></p>
                <p>Language: <strong>{selected.metadata?.language || 'n/a'}</strong></p>
                <p>Periodicity: <strong>{selected.metadata?.periodicity || 'n/a'}</strong></p>
                <p>State: <strong>{selected.metadata?.state || 'n/a'}</strong>
                  {selected.metadata?.district ? ` (${selected.metadata.district})` : ''}</p>
                <p>Status: <strong style={{
                  color: selected.metadata?.source === 'PENDING' ? '#b45309' : '#059669'
                }}>
                  {selected.metadata?.source === 'PENDING'
                    ? 'Application pending in the queue'
                    : 'Active in the national register'}
                </strong></p>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
};

// Small local helper so the import list stays tidy.
const Shield16 = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

export default VerificationResult;
