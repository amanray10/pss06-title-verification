import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Download,
  ExternalLink,
  ChevronRight,
  FileText,
  PlusCircle,
  Loader2,
  Clock
} from 'lucide-react';
import AppShell from '../components/AppShell';
import { api } from '../api/client';

const STATUS_FILTERS = [
  { id: 'ALL', label: 'All Outcomes' },
  { id: 'ACCEPT', label: 'Accepted' },
  { id: 'REVIEW', label: 'Manual Review' },
  { id: 'REJECT', label: 'Rejected' }
];

const decisionMeta = {
  ACCEPT: { label: 'Accepted', cls: 'badge-accepted', Icon: CheckCircle2 },
  REVIEW: { label: 'Manual Review', cls: 'badge-review-gov', Icon: AlertTriangle },
  REJECT: { label: 'Rejected', cls: 'badge-rejected-gov', Icon: XCircle }
};

const fmtDate = (v) =>
  v ? new Date(v).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }) : '-';

export const MyVerifications = ({ user, onNavigate, onLogout, onSelectVerification }) => {
  const [records, setRecords] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [opening, setOpening] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      api.history({ scope: 'all', decision: 'ALL', limit: 300 }),
      api.pendingApplications('all').catch(() => ({ applications: [] }))
    ])
      .then(([hist, pend]) => {
        if (!alive) return;
        setRecords(hist.records || []);
        setPending(pend.applications || []);
        setError('');
      })
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      const okStatus = filter === 'ALL' || r.decision === filter;
      const okSearch = !q
        || r.title?.toLowerCase().includes(q)
        || r.trackingId?.toLowerCase().includes(q)
        || (r.publisher || '').toLowerCase().includes(q);
      return okStatus && okSearch;
    });
  }, [records, filter, search]);

  const counts = useMemo(() => ({
    total: records.length,
    accepted: records.filter((r) => r.decision === 'ACCEPT').length,
    review: records.filter((r) => r.decision === 'REVIEW').length,
    rejected: records.filter((r) => r.decision === 'REJECT').length
  }), [records]);

  const openRecord = async (trackingId) => {
    setOpening(trackingId);
    try {
      const data = await api.historyDetail(trackingId);
      onSelectVerification?.({ ...data.record, fromHistory: true });
    } catch (err) {
      alert(err.message);
    } finally {
      setOpening(null);
    }
  };

  /** Download the record as a JSON dossier - no server round trip needed. */
  const downloadRecord = async (record) => {
    try {
      const data = await api.historyDetail(record.trackingId);
      const blob = new Blob([JSON.stringify(data.record, null, 2)],
        { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${record.trackingId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message);
    }
  };

  const exportLedger = () => {
    const header = ['Tracking ID', 'Title', 'Language', 'Decision',
      'Similarity %', 'Verification Probability %', 'Confidence', 'Date'];
    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      header.join(','),
      ...filtered.map((r) => [
        r.trackingId, r.title, r.language, r.decision,
        r.similarityScore, r.verificationProbability, r.confidence,
        r.createdAt
      ].map(escape).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prgi-verification-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell
      active="my-verifications"
      title="My Verifications"
      user={user}
      onNavigate={onNavigate}
      onLogout={onLogout}
      topbarRight={
        <button type="button" className="btn btn-primary btn-sm"
                onClick={() => onNavigate('dashboard')}>
          <PlusCircle size={15} />
          <span>New Verification</span>
        </button>
      }
    >
      <div className="gov-breadcrumb">
        <span className="breadcrumb-link" onClick={() => onNavigate('dashboard')}>
          Dashboard
        </span>
        <ChevronRight size={14} className="breadcrumb-separator" />
        <span className="breadcrumb-current">My Verifications</span>
      </div>

      <div className="gov-welcome-banner">
        <h2 className="gov-welcome-title">Verification History</h2>
        <p className="gov-welcome-sub">
          Every title checked against the register, with its similarity score,
          decision and the rules that produced it.
        </p>
      </div>

      <div className="gov-metrics-4grid" style={{ marginBottom: '24px' }}>
        <StatCard label="TOTAL REQUESTS" value={counts.total} border="border-blue"
                  bg="icon-bg-blue" icon={<FileText size={20} color="#02529c" />} />
        <StatCard label="ACCEPTED" value={counts.accepted} border="border-green"
                  bg="icon-bg-green" icon={<CheckCircle2 size={20} color="#059669" />} />
        <StatCard label="MANUAL REVIEW" value={counts.review} border="border-orange"
                  bg="icon-bg-orange" icon={<AlertTriangle size={20} color="#d97706" />} />
        <StatCard label="REJECTED" value={counts.rejected} border="border-red"
                  bg="icon-bg-red" icon={<XCircle size={20} color="#dc2626" />} />
      </div>

      {pending.length > 0 && (
        <div className="gov-pending-strip">
          <Clock size={15} />
          <span>
            <strong>{pending.length}</strong> application
            {pending.length > 1 ? 's are' : ' is'} live in the queue and will
            block later look-alike submissions:
          </span>
          <span className="gov-pending-titles">
            {pending.slice(0, 4).map((p) => p.title).join(' · ')}
            {pending.length > 4 ? ` · +${pending.length - 4} more` : ''}
          </span>
        </div>
      )}

      <div className="gov-history-toolbar">
        <div className="gov-history-search">
          <Search size={16} className="gov-history-search-icon" />
          <input
            type="text"
            placeholder="Search by title, tracking ID or publisher..."
            className="gov-history-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="gov-history-filters">
          <div className="gov-pill-filter-group">
            {STATUS_FILTERS.map((st) => (
              <button
                key={st.id}
                type="button"
                className={`gov-filter-pill-btn ${filter === st.id ? 'active' : ''}`}
                onClick={() => setFilter(st.id)}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="gov-table-card">
        <div className="gov-table-header-flex">
          <h3 className="gov-table-card-title" style={{ marginBottom: 0 }}>
            Verification Records ({filtered.length})
          </h3>
          <button type="button" className="btn btn-outline btn-sm"
                  onClick={exportLedger} disabled={!filtered.length}>
            <Download size={14} />
            <span>Export Ledger (CSV)</span>
          </button>
        </div>

        {error && (
          <div className="gov-form-error" style={{ marginTop: 14 }}>
            <XCircle size={15} /><span>{error}</span>
          </div>
        )}

        <div className="gov-table-responsive" style={{ marginTop: '16px' }}>
          <table className="gov-verifications-table">
            <thead>
              <tr>
                <th>Tracking ID</th>
                <th>Proposed Title</th>
                <th>Language &amp; Type</th>
                <th>Similarity</th>
                <th>Verification Chance</th>
                <th>Outcome</th>
                <th>Timestamp</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '40px' }}>
                    <Loader2 size={22} className="spin" />
                  </td>
                </tr>
              )}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '36px 20px', color: '#64748b' }}>
                    {records.length === 0
                      ? 'No verifications recorded yet. Check your first title from the dashboard.'
                      : 'No records match your filters.'}
                  </td>
                </tr>
              )}

              {!loading && filtered.map((item) => {
                const meta = decisionMeta[item.decision] || decisionMeta.REVIEW;
                const score = Number(item.similarityScore);
                const prob = Number(item.verificationProbability);
                return (
                  <tr key={item.trackingId}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, color: '#02529c' }}>
                      {item.trackingId}
                    </td>
                    <td>
                      <div style={{ fontWeight: 700, color: '#0c1e3d' }}>{item.title}</div>
                      {item.publisher && (
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>
                          Publisher: {item.publisher}
                        </div>
                      )}
                    </td>
                    <td>
                      <span style={{ fontSize: '0.84rem', color: '#334155' }}>
                        {item.language || '-'}
                        {item.publicationType ? ` · ${item.publicationType}` : ''}
                      </span>
                    </td>
                    <td>
                      <div className="gov-score-progress-cell">
                        <span className={`gov-score-text ${score >= 85 ? 'text-red'
                          : score >= 65 ? 'text-orange' : ''}`}>
                          {score.toFixed(0)}%
                        </span>
                        <div className="gov-progress-track">
                          <div className={`gov-progress-fill ${score >= 85 ? 'progress-red'
                            : score >= 65 ? 'progress-orange' : 'progress-green'}`}
                            style={{ width: `${Math.min(score, 100)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`gov-prob-chip ${prob >= 60 ? 'good'
                        : prob >= 30 ? 'mid' : 'bad'}`}>
                        {prob.toFixed(0)}%
                      </span>
                    </td>
                    <td>
                      <span className={`gov-status-badge ${meta.cls}`}>
                        <meta.Icon size={12} strokeWidth={2.5} /> {meta.label}
                      </span>
                    </td>
                    <td className="gov-td-date">{fmtDate(item.createdAt)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                        <button type="button" className="btn btn-outline btn-sm"
                                onClick={() => openRecord(item.trackingId)}
                                disabled={opening === item.trackingId}
                                title="Open the full evidence report">
                          {opening === item.trackingId
                            ? <Loader2 size={13} className="spin" />
                            : <ExternalLink size={13} />}
                          <span>Inspect</span>
                        </button>
                        <button type="button" className="btn-icon"
                                onClick={() => downloadRecord(item)}
                                title="Download the verification dossier"
                                style={{ color: '#64748b' }}>
                          <Download size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
};

const StatCard = ({ label, value, border, bg, icon }) => (
  <div className={`gov-stat-card ${border}`}>
    <div>
      <span className="gov-stat-label">{label}</span>
      <div className="gov-stat-number">{value}</div>
    </div>
    <div className={`gov-stat-icon-wrap ${bg}`}>{icon}</div>
  </div>
);

export default MyVerifications;
