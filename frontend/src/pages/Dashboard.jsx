import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Shield,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  BarChart3,
  ArrowRight,
  Loader2,
  Ban,
  Database
} from 'lucide-react';
import AppShell from '../components/AppShell';
import { api } from '../api/client';

const LANGUAGES = ['English', 'Hindi', 'Bengali', 'Marathi', 'Tamil', 'Telugu',
  'Gujarati', 'Kannada', 'Malayalam', 'Oriya', 'Punjabi', 'Urdu', 'Assamese'];

const PUB_TYPES = ['Newspaper', 'Magazine', 'Journal', 'Gazette', 'Periodical'];

const PERIODICITIES = ['Daily', 'Weekly', 'Fortnightly', 'Monthly',
  'Bimonthly', 'Quarterly', 'Half Yearly', 'Annual'];

const decisionMeta = {
  ACCEPT: { label: 'Accepted', cls: 'badge-accepted', Icon: CheckCircle2 },
  REVIEW: { label: 'Manual Review', cls: 'badge-review-gov', Icon: AlertTriangle },
  REJECT: { label: 'Rejected', cls: 'badge-rejected-gov', Icon: XCircle }
};

const barClass = (score) =>
  score >= 85 ? 'progress-red' : score >= 65 ? 'progress-orange' : 'progress-green';

export const Dashboard = ({ user, onNavigate, onLogout, onVerified }) => {
  const [proposedTitle, setProposedTitle] = useState('');
  const [language, setLanguage] = useState('English');
  const [publicationType, setPublicationType] = useState('Newspaper');
  const [periodicity, setPeriodicity] = useState('Daily');
  const [publisher, setPublisher] = useState('');
  const [trackApplication, setTrackApplication] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [liveWarning, setLiveWarning] = useState(null);

  const [overview, setOverview] = useState(null);
  const debounceRef = useRef(null);

  const loadOverview = () => {
    api.overview('all')
      .then(setOverview)
      .catch(() => setOverview(null));
  };

  useEffect(loadOverview, []);

  // Requirement 6.a - warn about prohibited vocabulary while the applicant
  // is still typing, before they ever press Verify.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const value = proposedTitle.trim();
    if (value.length < 3) {
      setLiveWarning(null);
      return undefined;
    }
    debounceRef.current = setTimeout(() => {
      api.guidelineCheck(value)
        .then((res) => {
          const blockers = (res.findings || []).filter((f) => f.severity === 'BLOCKER');
          setLiveWarning(blockers.length ? blockers[0].message : null);
        })
        .catch(() => setLiveWarning(null));
    }, 450);
    return () => clearTimeout(debounceRef.current);
  }, [proposedTitle]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const title = proposedTitle.trim();
    if (!title) {
      setError('Please enter the publication title you want to verify.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      const data = await api.verifyTitle({
        title, language, publicationType, periodicity,
        publisher: publisher.trim() || null,
        trackApplication
      });
      loadOverview();
      onVerified?.({
        ...data.result,
        trackingId: data.trackingId,
        applicationRef: data.applicationRef,
        persisted: data.persisted
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const s = overview?.stats;
  const stats = [
    { id: 'total', label: 'TOTAL VERIFICATIONS', value: s?.totalVerifications ?? 0,
      borderClass: 'border-blue', iconClass: 'icon-bg-blue',
      icon: <BarChart3 size={20} color="#02529c" /> },
    { id: 'accepted', label: 'ACCEPTED', value: s?.accepted ?? 0,
      borderClass: 'border-green', iconClass: 'icon-bg-green',
      icon: <CheckCircle2 size={20} color="#059669" /> },
    { id: 'review', label: 'MANUAL REVIEW', value: s?.manualReview ?? 0,
      borderClass: 'border-orange', iconClass: 'icon-bg-orange',
      icon: <AlertTriangle size={20} color="#d97706" /> },
    { id: 'rejected', label: 'REJECTED', value: s?.rejected ?? 0,
      borderClass: 'border-red', iconClass: 'icon-bg-red',
      icon: <XCircle size={20} color="#dc2626" /> }
  ];

  const recent = overview?.recentVerifications || [];
  const maxTrend = Math.max(1, ...(overview?.submissionTrends || []).map((t) => t.count));

  return (
    <AppShell
      active="dashboard"
      title="Title Verification System"
      user={user}
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      <div className="gov-welcome-banner">
        <h2 className="gov-welcome-title">
          Welcome, {user?.username || 'Officer'}
        </h2>
        <p className="gov-welcome-sub">
          Check a proposed publication title against the PRGI register before the
          application is filed.
        </p>
      </div>

      {/* ------------------------------------------------ verification form */}
      <div className="gov-check-title-card">
        <div className="gov-check-header">
          <div className="gov-shield-icon-bubble">
            <Shield size={22} color="#02529c" />
          </div>
          <div>
            <h3 className="gov-check-card-title">Check a New Publication Title</h3>
            <p className="gov-check-card-sub">
              The title is compared against{' '}
              <strong>
                {overview?.stats?.registrySize
                  ? Number(overview.stats.registrySize).toLocaleString()
                  : 'all'}
              </strong>{' '}
              registered titles using multilingual semantic search, phonetic
              matching and the PRGI guideline rules.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="gov-check-form">
          <div className="form-group">
            <label className="gov-input-label" htmlFor="proposed-title-input">
              Proposed Publication Title
            </label>
            <div className="gov-search-input-wrap">
              <Search size={16} className="gov-search-icon-inside" />
              <input
                id="proposed-title-input"
                type="text"
                className="gov-title-text-input"
                placeholder="e.g. Dainik Bharat Samachar"
                value={proposedTitle}
                maxLength={300}
                autoComplete="off"
                onChange={(e) => { setError(''); setProposedTitle(e.target.value); }}
              />
            </div>

            {liveWarning && (
              <div className="gov-live-warning">
                <Ban size={14} />
                <span>{liveWarning}</span>
              </div>
            )}
          </div>

          <div className="gov-form-bottom-row">
            <div className="form-group" style={{ flex: 1, minWidth: 150 }}>
              <label className="gov-input-label">Language</label>
              <select className="gov-select-input" value={language}
                      onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            <div className="form-group" style={{ flex: 1, minWidth: 150 }}>
              <label className="gov-input-label">Publication Type</label>
              <select className="gov-select-input" value={publicationType}
                      onChange={(e) => setPublicationType(e.target.value)}>
                {PUB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="form-group" style={{ flex: 1, minWidth: 150 }}>
              <label className="gov-input-label">Periodicity</label>
              <select className="gov-select-input" value={periodicity}
                      onChange={(e) => setPeriodicity(e.target.value)}>
                {PERIODICITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div className="form-group" style={{ flex: 1.4, minWidth: 180 }}>
              <label className="gov-input-label">Publisher (optional)</label>
              <input
                type="text"
                className="gov-select-input"
                placeholder="Publishing house or owner"
                value={publisher}
                onChange={(e) => setPublisher(e.target.value)}
              />
            </div>

            <div className="gov-verify-btn-wrap">
              <button type="submit" className="btn btn-primary gov-btn-verify"
                      disabled={loading}>
                {loading
                  ? <Loader2 size={16} className="spin" />
                  : <Shield size={16} />}
                <span>{loading ? 'Checking registry...' : 'Verify Title'}</span>
              </button>
            </div>
          </div>

          <label className="gov-track-toggle">
            <input
              type="checkbox"
              checked={trackApplication}
              onChange={(e) => setTrackApplication(e.target.checked)}
            />
            <span>
              Record this as a live application, so any similar title submitted
              later by another applicant is blocked against it.
            </span>
          </label>

          {error && (
            <div className="gov-form-error">
              <XCircle size={15} />
              <span>{error}</span>
            </div>
          )}
        </form>
      </div>

      {/* ------------------------------------------------------------ stats */}
      <div className="gov-metrics-4grid">
        {stats.map((st) => (
          <div key={st.id} className={`gov-stat-card ${st.borderClass}`}>
            <div>
              <span className="gov-stat-label">{st.label}</span>
              <div className="gov-stat-number">{st.value}</div>
            </div>
            <div className={`gov-stat-icon-wrap ${st.iconClass}`}>{st.icon}</div>
          </div>
        ))}
      </div>

      <div className="gov-two-col">
        {/* ------------------------------------------- recent verifications */}
        <div className="gov-table-card">
          <h3 className="gov-table-card-title">Recent Verifications</h3>

          {recent.length === 0 ? (
            <div className="gov-empty-state">
              <Database size={26} />
              <p>No verifications yet.</p>
              <span>Check your first title using the form above.</span>
            </div>
          ) : (
            <div className="gov-table-responsive">
              <table className="gov-verifications-table">
                <thead>
                  <tr>
                    <th>Publication Title</th>
                    <th>Similarity</th>
                    <th>Result</th>
                    <th>Date</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((row) => {
                    const meta = decisionMeta[row.decision] || decisionMeta.REVIEW;
                    const score = Number(row.similarityScore);
                    return (
                      <tr key={row.trackingId}>
                        <td className="gov-td-title">{row.title}</td>
                        <td>
                          <div className="gov-score-progress-cell">
                            <span className={`gov-score-text ${score >= 85 ? 'text-red'
                              : score >= 65 ? 'text-orange' : ''}`}>
                              {score.toFixed(0)}%
                            </span>
                            <div className="gov-progress-track">
                              <div className={`gov-progress-fill ${barClass(score)}`}
                                   style={{ width: `${Math.min(score, 100)}%` }} />
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`gov-status-badge ${meta.cls}`}>
                            <meta.Icon size={12} strokeWidth={2.5} /> {meta.label}
                          </span>
                        </td>
                        <td className="gov-td-date">
                          {new Date(row.createdAt).toLocaleDateString('en-IN', {
                            day: '2-digit', month: 'short', year: 'numeric'
                          })}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="gov-link-details-btn"
                            onClick={async () => {
                              try {
                                const d = await api.historyDetail(row.trackingId);
                                onVerified?.({ ...d.record, fromHistory: true });
                              } catch (err) {
                                alert(err.message);
                              }
                            }}
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="gov-table-footer">
            <button type="button" className="gov-view-history-btn"
                    onClick={() => onNavigate('my-verifications')}>
              <span>View All History</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>

        {/* ------------------------------------------------ weekly activity */}
        <div className="gov-table-card">
          <h3 className="gov-table-card-title">Verification Activity (7 days)</h3>
          <div className="gov-bar-chart">
            {(overview?.submissionTrends || []).map((t) => (
              <div key={t.date} className="gov-bar-col" title={`${t.count} on ${t.date}`}>
                <div className="gov-bar-track">
                  <div
                    className="gov-bar-fill"
                    style={{ height: `${Math.max(4, (t.count / maxTrend) * 100)}%` }}
                  />
                </div>
                <span className="gov-bar-value">{t.count}</span>
                <span className="gov-bar-label">{t.day}</span>
              </div>
            ))}
          </div>

          <div className="gov-mini-stats">
            <div>
              <span className="gov-mini-label">Average similarity</span>
              <strong>{s?.averageSimilarity ?? 0}%</strong>
            </div>
            <div>
              <span className="gov-mini-label">Average verification chance</span>
              <strong>{s?.averageProbability ?? 0}%</strong>
            </div>
            <div>
              <span className="gov-mini-label">Titles in registry</span>
              <strong>
                {s?.registrySize ? Number(s.registrySize).toLocaleString() : '-'}
              </strong>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
};

export default Dashboard;
