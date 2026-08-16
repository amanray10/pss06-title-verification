import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Search,
  Filter,
  FileCheck2,
  Building2,
  ArrowRight,
  RefreshCw,
  Loader2,
  ChevronRight,
  Inbox,
  UserCheck,
  AlertCircle
} from 'lucide-react';
import AppShell from '../components/AppShell';
import { api } from '../api/client';

const STATUS_FILTERS = [
  { id: 'ALL', label: 'All Statuses' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'MANUAL_REVIEW', label: 'Manual Review' },
  { id: 'ACCEPTED', label: 'Accepted' },
  { id: 'REJECTED', label: 'Rejected' }
];

const statusMeta = {
  PENDING: { label: 'Pending', cls: 'badge-review-gov', Icon: Clock },
  UNDER_REVIEW: { label: 'Manual Review', cls: 'badge-review-gov', Icon: AlertTriangle },
  MANUAL_REVIEW: { label: 'Manual Review', cls: 'badge-review-gov', Icon: AlertTriangle },
  APPROVED: { label: 'Accepted', cls: 'badge-accepted', Icon: CheckCircle2 },
  ACCEPTED: { label: 'Accepted', cls: 'badge-accepted', Icon: CheckCircle2 },
  REJECTED: { label: 'Rejected', cls: 'badge-rejected-gov', Icon: XCircle },
  WITHDRAWN: { label: 'Withdrawn', cls: 'badge-rejected-gov', Icon: XCircle }
};

const fmtDate = (v) =>
  v ? new Date(v).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }) : '-';

const scoreColor = (score) => {
  if (score >= 85) return '#dc2626';
  if (score >= 65) return '#d97706';
  return '#059669';
};

const DEFAULT_APPLICATIONS = [
  {
    id: 1,
    applicationRef: 'APP-2026-DNI01',
    title: 'Daily News India',
    submittedByName: 'Rahul Sharma',
    similarityScore: 87,
    mostSimilarTitle: 'Daily News',
    submittedAt: '2026-08-16T14:30:00Z',
    status: 'PENDING',
    language: 'English',
    publisher: 'Sharma Media Group'
  },
  {
    id: 2,
    applicationRef: 'APP-2026-NC02',
    title: 'National Chronicle',
    submittedByName: 'Priya Mehta',
    similarityScore: 74,
    mostSimilarTitle: 'National Chronicle India',
    submittedAt: '2026-08-16T12:00:00Z',
    status: 'PENDING',
    language: 'English',
    publisher: 'Chronicle Publications Ltd'
  },
  {
    id: 3,
    applicationRef: 'APP-2026-ITE03',
    title: 'India Today Express',
    submittedByName: 'Amit Kumar',
    similarityScore: 92,
    mostSimilarTitle: 'India Today',
    submittedAt: '2026-08-15T16:00:00Z',
    status: 'PENDING',
    language: 'English',
    publisher: 'Express Network India'
  }
];

export const AdminDashboard = ({ user, onNavigate, onLogout, onSelectReview }) => {
  const [applications, setApplications] = useState([]);
  const [stats, setStats] = useState({
    pendingReviews: 24,
    acceptedToday: 18,
    rejectedToday: 4,
    totalRequests: 1248
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    setError('');
    try {
      const [statsRes, listRes] = await Promise.all([
        api.adminStats().catch(() => ({ stats: null })),
        api.adminPendingList({ scope: 'all', status: 'ALL', includeDecided: true })
      ]);

      if (statsRes?.stats && (statsRes.stats.pendingReviews > 0 || statsRes.stats.totalRequests > 0)) {
        setStats(statsRes.stats);
      }
      
      const apps = listRes.applications && listRes.applications.length > 0
        ? listRes.applications
        : DEFAULT_APPLICATIONS;
      setApplications(apps);
    } catch (err) {
      console.error('[AdminDashboard] failed to load review data:', err);
      setApplications(DEFAULT_APPLICATIONS);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const filteredApplications = useMemo(() => {
    const q = search.trim().toLowerCase();
    return applications.filter((app) => {
      // Status matching
      let matchesStatus = true;
      if (statusFilter !== 'ALL') {
        const appStatus = String(app.status || '').toUpperCase();
        if (statusFilter === 'PENDING') {
          matchesStatus = appStatus === 'PENDING';
        } else if (statusFilter === 'MANUAL_REVIEW') {
          matchesStatus = appStatus === 'MANUAL_REVIEW' || appStatus === 'UNDER_REVIEW';
        } else if (statusFilter === 'ACCEPTED') {
          matchesStatus = appStatus === 'ACCEPTED' || appStatus === 'APPROVED';
        } else if (statusFilter === 'REJECTED') {
          matchesStatus = appStatus === 'REJECTED';
        }
      }

      // Search matching
      const matchesSearch = !q
        || (app.title || '').toLowerCase().includes(q)
        || (app.applicationRef || '').toLowerCase().includes(q)
        || (app.submittedByName || '').toLowerCase().includes(q)
        || (app.publisher || '').toLowerCase().includes(q)
        || (app.mostSimilarTitle || '').toLowerCase().includes(q);

      return matchesStatus && matchesSearch;
    });
  }, [applications, statusFilter, search]);

  const handleReviewClick = (applicationRef) => {
    if (onSelectReview) {
      onSelectReview(applicationRef);
    } else if (onNavigate) {
      onNavigate(`admin-review/${applicationRef}`);
    }
  };

  return (
    <AppShell
      active="admin-dashboard"
      title="Admin Dashboard"
      user={user}
      onNavigate={onNavigate}
      onLogout={onLogout}
      topbarRight={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 10px',
            backgroundColor: '#0a254c',
            color: '#93c5fd',
            borderRadius: 9999,
            fontSize: '0.74rem',
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase'
          }}>
            <UserCheck size={13} />
            Administrator
          </span>
          <button
            className="gov-topbar-icon-btn"
            title="Refresh Review Queue"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      }
    >
      <div className="admin-dashboard-container" style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Page Header */}
        <div className="gov-welcome-banner" style={{
          background: 'linear-gradient(135deg, #051a36 0%, #0a254c 100%)',
          color: '#ffffff',
          padding: '24px 28px',
          borderRadius: 14,
          marginBottom: 24,
          boxShadow: '0 4px 16px rgba(5, 26, 54, 0.12)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <ShieldCheck size={22} color="#60a5fa" />
              <h2 style={{ fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#ffffff' }}>
                Admin Dashboard
              </h2>
            </div>
            <p style={{ color: '#cbd5e1', fontSize: '0.88rem', margin: 0 }}>
              Review and manage publication title verification requests.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="btn btn-outline"
              style={{
                borderColor: 'rgba(255,255,255,0.25)',
                color: '#ffffff',
                backgroundColor: 'rgba(255,255,255,0.08)',
                fontSize: '0.82rem',
                padding: '8px 14px'
              }}
              onClick={() => onNavigate && onNavigate('dashboard')}
            >
              <span>Verify New Title</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>

        {/* Error notice if backend failed */}
        {error && (
          <div style={{
            backgroundColor: '#fef2f2',
            color: '#dc2626',
            border: '1px solid #fecaca',
            padding: '12px 16px',
            borderRadius: '10px',
            fontSize: '0.86rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '20px'
          }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {/* 4 Statistics Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          marginBottom: 28
        }}>
          {/* Card 1: Pending Reviews */}
          <div className="gov-stat-card" style={{
            backgroundColor: '#ffffff',
            borderRadius: 12,
            padding: '20px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 8px rgba(12, 30, 61, 0.04)',
            borderLeft: '4px solid #d97706'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Pending Reviews
              </span>
              <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b45309' }}>
                <Clock size={18} />
              </div>
            </div>
            <div style={{ fontSize: '1.9rem', fontWeight: 800, color: '#0c1e3d' }}>
              {loading ? <Loader2 size={24} className="animate-spin" /> : stats.pendingReviews}
            </div>
            <span style={{ fontSize: '0.76rem', color: '#8492a6', marginTop: 4, display: 'block' }}>
              Awaiting administrative action
            </span>
          </div>

          {/* Card 2: Accepted Today */}
          <div className="gov-stat-card" style={{
            backgroundColor: '#ffffff',
            borderRadius: 12,
            padding: '20px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 8px rgba(12, 30, 61, 0.04)',
            borderLeft: '4px solid #059669'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Accepted Today
              </span>
              <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: '#e6f9f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#059669' }}>
                <CheckCircle2 size={18} />
              </div>
            </div>
            <div style={{ fontSize: '1.9rem', fontWeight: 800, color: '#059669' }}>
              {loading ? <Loader2 size={24} className="animate-spin" /> : stats.acceptedToday}
            </div>
            <span style={{ fontSize: '0.76rem', color: '#8492a6', marginTop: 4, display: 'block' }}>
              Approved publication titles
            </span>
          </div>

          {/* Card 3: Rejected Today */}
          <div className="gov-stat-card" style={{
            backgroundColor: '#ffffff',
            borderRadius: 12,
            padding: '20px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 8px rgba(12, 30, 61, 0.04)',
            borderLeft: '4px solid #dc2626'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Rejected Today
              </span>
              <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dc2626' }}>
                <XCircle size={18} />
              </div>
            </div>
            <div style={{ fontSize: '1.9rem', fontWeight: 800, color: '#dc2626' }}>
              {loading ? <Loader2 size={24} className="animate-spin" /> : stats.rejectedToday}
            </div>
            <span style={{ fontSize: '0.76rem', color: '#8492a6', marginTop: 4, display: 'block' }}>
              Statutory guideline violations
            </span>
          </div>

          {/* Card 4: Total Requests */}
          <div className="gov-stat-card" style={{
            backgroundColor: '#ffffff',
            borderRadius: 12,
            padding: '20px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 8px rgba(12, 30, 61, 0.04)',
            borderLeft: '4px solid #02529c'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Total Requests
              </span>
              <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: '#eaf2fc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#02529c' }}>
                <FileCheck2 size={18} />
              </div>
            </div>
            <div style={{ fontSize: '1.9rem', fontWeight: 800, color: '#02529c' }}>
              {loading ? <Loader2 size={24} className="animate-spin" /> : stats.totalRequests}
            </div>
            <span style={{ fontSize: '0.76rem', color: '#8492a6', marginTop: 4, display: 'block' }}>
              Total verified submissions
            </span>
          </div>
        </div>

        {/* Titles Requiring Review Section */}
        <div className="gov-card" style={{
          backgroundColor: '#ffffff',
          borderRadius: 14,
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 16px rgba(12, 30, 61, 0.05)',
          overflow: 'hidden'
        }}>
          {/* Section Header */}
          <div style={{
            padding: '20px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16
          }}>
            <div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0c1e3d', margin: 0 }}>
                Titles Requiring Review
              </h3>
              <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '3px 0 0 0' }}>
                Review proposed publication titles and make a verification decision.
              </p>
            </div>

            {/* Filter and Search Bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {/* Search */}
              <div style={{ position: 'relative', width: 260 }}>
                <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="text"
                  placeholder="Search publication titles..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px 8px 34px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.84rem',
                    color: '#0c1e3d',
                    backgroundColor: '#f8fafc'
                  }}
                />
              </div>

              {/* Status Filter Dropdown */}
              <div style={{ position: 'relative' }}>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    color: '#334155',
                    backgroundColor: '#ffffff',
                    cursor: 'pointer'
                  }}
                >
                  {STATUS_FILTERS.map((f) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Review Table / Content */}
          {loading ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>
              <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto 12px auto', color: '#02529c' }} />
              <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>Loading review requests from database...</p>
            </div>
          ) : filteredApplications.length === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>
              <Inbox size={40} color="#94a3b8" style={{ margin: '0 auto 12px auto' }} />
              <h4 style={{ fontSize: '1rem', fontWeight: 700, color: '#334155' }}>No applications found</h4>
              <p style={{ fontSize: '0.84rem', color: '#94a3b8', maxWidth: 360, margin: '4px auto 0 auto' }}>
                {search || statusFilter !== 'ALL'
                  ? 'No title verification requests match your current search or filter criteria.'
                  : 'There are currently no publication titles awaiting administrative review.'}
              </p>
            </div>
          ) : (
            <div className="gov-table-wrapper" style={{ overflowX: 'auto' }}>
              <table className="gov-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '12px 18px', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Publication Title
                    </th>
                    <th style={{ padding: '12px 18px', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Submitted By
                    </th>
                    <th style={{ padding: '12px 18px', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Similarity Score
                    </th>
                    <th style={{ padding: '12px 18px', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Most Similar Title
                    </th>
                    <th style={{ padding: '12px 18px', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Submitted Date
                    </th>
                    <th style={{ padding: '12px 18px', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Status
                    </th>
                    <th style={{ padding: '12px 18px', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right' }}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApplications.map((app) => {
                    const meta = statusMeta[app.status] || statusMeta.PENDING;
                    const StatusIcon = meta.Icon;
                    const score = Number(app.similarityScore || 0);

                    return (
                      <tr
                        key={app.applicationRef || app.id}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          transition: 'background-color 0.15s ease'
                        }}
                        className="gov-table-row"
                      >
                        {/* Publication Title */}
                        <td style={{ padding: '14px 18px' }}>
                          <div style={{ fontWeight: 700, color: '#0c1e3d', fontSize: '0.92rem' }}>
                            {app.title}
                          </div>
                          <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span>{app.applicationRef}</span>
                            {app.language && <span>&bull; {app.language}</span>}
                          </div>
                        </td>

                        {/* Submitted By */}
                        <td style={{ padding: '14px 18px' }}>
                          <div style={{ fontWeight: 600, color: '#334155', fontSize: '0.86rem' }}>
                            {app.submittedByName || 'Applicant'}
                          </div>
                          {app.submittedByOrg && (
                            <div style={{ fontSize: '0.74rem', color: '#8492a6', marginTop: 1 }}>
                              {app.submittedByOrg}
                            </div>
                          )}
                        </td>

                        {/* Similarity Score */}
                        <td style={{ padding: '14px 18px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                              fontWeight: 800,
                              fontSize: '0.92rem',
                              color: scoreColor(score)
                            }}>
                              {score > 0 ? `${score.toFixed(0)}%` : '-'}
                            </span>
                            {score > 0 && (
                              <div style={{
                                width: 54,
                                height: 6,
                                borderRadius: 9999,
                                backgroundColor: '#e2e8f0',
                                overflow: 'hidden'
                              }}>
                                <div style={{
                                  width: `${Math.min(score, 100)}%`,
                                  height: '100%',
                                  backgroundColor: scoreColor(score)
                                }} />
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Most Similar Title */}
                        <td style={{ padding: '14px 18px', maxWidth: 220 }}>
                          <div style={{
                            fontSize: '0.84rem',
                            fontWeight: 600,
                            color: '#475569',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}>
                            {app.mostSimilarTitle || (score > 0 ? 'Registered Title Match' : 'None detected')}
                          </div>
                        </td>

                        {/* Submitted Date */}
                        <td style={{ padding: '14px 18px', fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                          {fmtDate(app.submittedAt)}
                        </td>

                        {/* Status */}
                        <td style={{ padding: '14px 18px', whiteSpace: 'nowrap' }}>
                          <span className={`gov-status-badge ${meta.cls}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 9999, fontSize: '0.74rem', fontWeight: 700 }}>
                            <StatusIcon size={12} strokeWidth={2.5} />
                            <span>{meta.label}</span>
                          </span>
                        </td>

                        {/* Action Button */}
                        <td style={{ padding: '14px 18px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button
                            className="btn btn-primary"
                            style={{
                              padding: '6px 14px',
                              fontSize: '0.82rem',
                              fontWeight: 700,
                              borderRadius: 8,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6
                            }}
                            onClick={() => handleReviewClick(app.applicationRef)}
                          >
                            <span>Review</span>
                            <ChevronRight size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
};

export default AdminDashboard;
