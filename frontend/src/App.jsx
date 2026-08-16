import React, { useState, useEffect, useCallback } from 'react';
import Login from './pages/Login';
import CreateAccount from './pages/CreateAccount';
import EmailVerification from './pages/EmailVerification';
import Dashboard from './pages/Dashboard';
import VerificationResult from './pages/VerificationResult';
import MyVerifications from './pages/MyVerifications';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import AdminReview from './pages/AdminReview';
import { api, tokenStore } from './api/client';

export function App() {
  const [currentPage, setCurrentPage] = useState('login');
  const [user, setUser] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // The full response from POST /api/titles/verify - decision, scores,
  // findings, matched titles, explanation and the agent trace.
  const [verification, setVerification] = useState(null);

  // The selected application reference for admin review
  const [selectedAppRef, setSelectedAppRef] = useState(null);

  // Hash route parser
  const parseHashRoute = useCallback((hash, currentUser) => {
    const cleanHash = (hash || '').replace(/^#\/?/, '');
    if (cleanHash === 'admin/login') return { page: 'admin-login', ref: null };
    if (cleanHash === 'admin/dashboard') return { page: 'admin-dashboard', ref: null };
    if (cleanHash.startsWith('admin/review/')) {
      const ref = cleanHash.replace('admin/review/', '');
      return { page: 'admin-review', ref };
    }
    if (cleanHash === 'create-account') return { page: 'create-account', ref: null };
    if (cleanHash === 'my-verifications') return { page: 'my-verifications', ref: null };
    if (cleanHash === 'dashboard') return { page: 'dashboard', ref: null };
    return null;
  }, []);

  useEffect(() => {
    const token = tokenStore.get();
    if (!token) {
      const parsed = parseHashRoute(window.location.hash, null);
      if (parsed) {
        setCurrentPage(parsed.page);
        if (parsed.ref) setSelectedAppRef(parsed.ref);
      }
      setIsCheckingAuth(false);
      return;
    }
    api.me()
      .then((data) => {
        setUser(data.user);
        const parsed = parseHashRoute(window.location.hash, data.user);
        if (parsed) {
          setCurrentPage(parsed.page);
          if (parsed.ref) setSelectedAppRef(parsed.ref);
        } else {
          // Default to dashboard
          setCurrentPage('dashboard');
        }
      })
      .catch(() => {
        tokenStore.clear();
        setUser(null);
        setCurrentPage('login');
      })
      .finally(() => setIsCheckingAuth(false));

    const handleHashChange = () => {
      const parsed = parseHashRoute(window.location.hash, user);
      if (parsed) {
        setCurrentPage(parsed.page);
        if (parsed.ref) setSelectedAppRef(parsed.ref);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [parseHashRoute]);

  const navigateTo = useCallback((page) => {
    if (page.startsWith('admin-review/')) {
      const ref = page.replace('admin-review/', '');
      setSelectedAppRef(ref);
      setCurrentPage('admin-review');
      window.location.hash = `#admin/review/${ref}`;
    } else {
      if (page === 'admin-dashboard') {
        window.location.hash = '#admin/dashboard';
      } else if (page === 'admin-login') {
        window.location.hash = '#admin/login';
      } else if (page === 'dashboard') {
        window.location.hash = '#dashboard';
      } else if (page === 'my-verifications') {
        window.location.hash = '#my-verifications';
      }
      setCurrentPage(page);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    navigateTo('dashboard');
  };

  const handleAdminLoginSuccess = (userData) => {
    setUser(userData);
    navigateTo('admin-dashboard');
  };

  const handleRegisterSuccess = (userData) => {
    setUser(userData);
    if (userData?.isVerified) {
      navigateTo('dashboard');
    } else {
      navigateTo('email-verification');
    }
  };

  const handleLogout = () => {
    tokenStore.clear();
    setUser(null);
    setVerification(null);
    setSelectedAppRef(null);
    navigateTo('login');
  };

  /** Called by Dashboard (fresh check) and MyVerifications (stored record). */
  const showVerification = (payload) => {
    setVerification(payload);
    navigateTo('verification-result');
  };

  const showAdminReview = (appRef) => {
    setSelectedAppRef(appRef);
    navigateTo(`admin-review/${appRef}`);
  };

  if (isCheckingAuth) {
    return (
      <div className="app-boot-screen">
        <div className="app-boot-spinner" />
        <p>Verifying secure session...</p>
      </div>
    );
  }

  const requireAuth = (node) =>
    user ? node : <Login onNavigate={navigateTo} onLoginSuccess={handleLoginSuccess} />;

  const isUserAdmin = user && String(user.role || '').toLowerCase().match(/admin|officer/);

  const requireAdmin = (node) => {
    if (!user) {
      return <AdminLogin onNavigate={navigateTo} onLoginSuccess={handleAdminLoginSuccess} />;
    }
    if (!isUserAdmin) {
      return (
        <div style={{ maxWidth: 600, margin: '60px auto', padding: '36px', backgroundColor: '#ffffff', borderRadius: 14, border: '1px solid #fee2e2', textAlign: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
          <h3 style={{ color: '#dc2626', fontWeight: 800, fontSize: '1.25rem', margin: 0 }}>403 - Administrator Access Restricted</h3>
          <p style={{ color: '#64748b', margin: '10px 0 24px 0', fontSize: '0.88rem', lineHeight: 1.5 }}>
            Your account (<strong>{user.email}</strong>) has the role <em>{user.role}</em>, which does not possess PRGI administrative review privileges.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => navigateTo('dashboard')}>
              Return to User Dashboard
            </button>
            <button className="btn btn-outline" onClick={handleLogout}>
              Sign In as Administrator
            </button>
          </div>
        </div>
      );
    }
    return node;
  };

  switch (currentPage) {
    case 'admin-login':
      return (
        <AdminLogin
          onNavigate={navigateTo}
          onLoginSuccess={handleAdminLoginSuccess}
        />
      );

    case 'admin-dashboard':
      return requireAdmin(
        <AdminDashboard
          user={user}
          onNavigate={navigateTo}
          onLogout={handleLogout}
          onSelectReview={showAdminReview}
        />
      );

    case 'admin-review':
      return requireAdmin(
        <AdminReview
          applicationRef={selectedAppRef}
          user={user}
          onNavigate={navigateTo}
          onLogout={handleLogout}
        />
      );

    case 'create-account':
      return (
        <CreateAccount onNavigate={navigateTo} onRegisterSuccess={handleRegisterSuccess} />
      );

    case 'email-verification':
      return (
        <EmailVerification
          email={user?.email || 'admin@prgi.gov'}
          onNavigate={navigateTo}
        />
      );

    case 'my-verifications':
      return requireAuth(
        <MyVerifications
          user={user}
          onNavigate={navigateTo}
          onLogout={handleLogout}
          onSelectVerification={showVerification}
        />
      );

    case 'verification-result':
      return requireAuth(
        <VerificationResult
          verification={verification}
          user={user}
          onNavigate={navigateTo}
          onLogout={handleLogout}
          onReverify={showVerification}
        />
      );

    case 'dashboard':
      return requireAuth(
        <Dashboard
          user={user}
          onNavigate={navigateTo}
          onLogout={handleLogout}
          onVerified={showVerification}
        />
      );

    case 'login':
    default:
      return <Login onNavigate={navigateTo} onLoginSuccess={handleLoginSuccess} />;
  }
}

export default App;
