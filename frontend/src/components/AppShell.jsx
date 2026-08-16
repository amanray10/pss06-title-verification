import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  PlusCircle,
  History,
  User,
  HelpCircle,
  LogOut,
  Bell,
  Settings,
  ShieldCheck,
  Menu,
  Cpu,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { api } from '../api/client';

/**
 * The deep-navy sidebar + topbar chrome shared by every signed-in page.
 *
 * It also owns the engine badge, which reports honestly whether the system is
 * running the full BGE-M3 + FAISS + Ollama stack or the LITE fallback.
 */
export const AppShell = ({
  active = 'dashboard',
  title = 'PRGI Title Verification System',
  user,
  onNavigate,
  onLogout,
  topbarRight = null,
  children
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [engine, setEngine] = useState(null);
  const [showEngine, setShowEngine] = useState(false);

  useEffect(() => {
    let alive = true;
    api.health()
      .then((h) => { if (alive) setEngine(h); })
      .catch(() => { if (alive) setEngine({ status: 'unreachable' }); });
    return () => { alive = false; };
  }, []);

  const go = (page) => {
    setMobileMenuOpen(false);
    onNavigate?.(page);
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, page: 'dashboard' },
    { id: 'new', label: 'New Verification', icon: PlusCircle, page: 'dashboard' },
    { id: 'my-verifications', label: 'My Verifications', icon: History, page: 'my-verifications' }
  ];

  const aiOk = engine?.aiService?.reachable;
  const dbOk = engine?.database?.connected;
  const mode = engine?.aiService?.mode;

  return (
    <div className="gov-layout-container">
      <div className="gov-mobile-bar">
        <button className="btn-icon" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          <Menu size={22} color="#ffffff" />
        </button>
        <span className="gov-mobile-title">PRGI Title Verification</span>
        <div style={{ width: 24 }} />
      </div>

      <aside className={`gov-sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="gov-sidebar-top">
          <div className="gov-sidebar-brand">
            <div className="gov-brand-seal">
              <ShieldCheck size={26} color="#ffffff" strokeWidth={2.4} />
            </div>
            <div>
              <h2 className="gov-brand-name">PRGI Portal</h2>
              <span className="gov-brand-sub">Title Verification System</span>
            </div>
          </div>

          <nav className="gov-nav-menu">
            {navItems.map(({ id, label, icon: Icon, page }) => (
              <button
                key={id}
                className={`gov-nav-item ${active === id ? 'active' : ''}`}
                onClick={() => go(page)}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}

            <button
              className="gov-nav-item"
              onClick={() => {
                setMobileMenuOpen(false);
                alert(
                  `Account\n\nName: ${user?.username || 'Officer'}\n`
                  + `Email: ${user?.email || '-'}\n`
                  + `Role: ${user?.role || '-'}\n`
                  + `Organisation: ${user?.organization || 'PRGI'}`
                );
              }}
            >
              <User size={18} />
              <span>Profile</span>
            </button>

            <button
              className="gov-nav-item"
              onClick={() => {
                setMobileMenuOpen(false);
                alert(
                  'PRGI Title Verification Help Desk\n\n'
                  + '1800-PRGI-VERIFY  |  support@prgi.gov.in\n\n'
                  + 'A title is rejected when it duplicates, re-spells, translates or '
                  + 'recombines an already registered title, or when it uses a '
                  + 'prohibited word.'
                );
              }}
            >
              <HelpCircle size={18} />
              <span>Help</span>
            </button>
          </nav>
        </div>

        <div className="gov-sidebar-bottom">
          <button className="gov-engine-chip" onClick={() => setShowEngine(!showEngine)}>
            <Cpu size={14} />
            <span>{mode ? `${mode} engine` : 'Engine status'}</span>
            <span className={`gov-dot ${aiOk ? 'ok' : 'bad'}`} />
          </button>

          {showEngine && (
            <div className="gov-engine-panel">
              <Row ok={aiOk} label="AI service"
                   value={aiOk ? `${mode} mode` : 'offline'} />
              <Row ok={dbOk} label="MySQL"
                   value={dbOk ? engine?.database?.name : 'offline'} />
              <Row ok={Boolean(engine?.aiService?.corpusSize)} label="Registry"
                   value={engine?.aiService?.corpusSize
                     ? `${Number(engine.aiService.corpusSize).toLocaleString()} titles`
                     : '-'} />
              <Row ok={Boolean(engine?.aiService?.ollama)} label="Ollama"
                   value={engine?.aiService?.ollama ? 'connected' : 'template mode'} />
              <div className="gov-engine-note">
                {engine?.aiService?.vectorBackend || 'retrieval backend unknown'}
              </div>
            </div>
          )}

          <button className="gov-nav-item text-danger" onClick={() => onLogout?.()}>
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <main className="gov-main-content">
        <header className="gov-topbar">
          <h1 className="gov-topbar-title">{title}</h1>
          <div className="gov-topbar-right">
            {topbarRight}
            <button className="gov-topbar-icon-btn" title="Notifications"
                    onClick={() => alert('Verification registries are fully operational.')}>
              <Bell size={18} />
            </button>
            <button className="gov-topbar-icon-btn" title="Settings"
                    onClick={() => setShowEngine(!showEngine)}>
              <Settings size={18} />
            </button>
            <div className="gov-avatar-wrapper" title={user?.username || 'User'}>
              <div className="gov-user-avatar-fallback" style={{ display: 'flex' }}>
                {(user?.username || 'U').trim().charAt(0).toUpperCase()}
              </div>
            </div>
          </div>
        </header>

        <div className="gov-page-body">
          {children}

          <footer className="gov-bottom-footer">
            <span className="gov-footer-copy">
              &copy; 2026 PRGI Title Verification System &bull; Ministry of Information &amp; Broadcasting
            </span>
            <span className="gov-footer-status">
              <span className={`gov-status-live-dot ${aiOk && dbOk ? '' : 'warn'}`} />
              <span>
                {aiOk && dbOk
                  ? 'System Status: All Systems Operational'
                  : 'System Status: Degraded - check the engine panel'}
              </span>
            </span>
          </footer>
        </div>
      </main>

      {mobileMenuOpen && (
        <div className="gov-sidebar-backdrop" onClick={() => setMobileMenuOpen(false)} />
      )}
    </div>
  );
};

const Row = ({ ok, label, value }) => (
  <div className="gov-engine-row">
    {ok ? <CheckCircle2 size={13} color="#10b981" />
        : <AlertTriangle size={13} color="#f59e0b" />}
    <span className="gov-engine-label">{label}</span>
    <span className="gov-engine-value">{value}</span>
  </div>
);

export default AppShell;
