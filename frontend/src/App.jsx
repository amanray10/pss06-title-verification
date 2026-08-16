import React, { useState, useEffect, useCallback } from 'react';
import Login from './pages/Login';
import CreateAccount from './pages/CreateAccount';
import EmailVerification from './pages/EmailVerification';
import Dashboard from './pages/Dashboard';
import VerificationResult from './pages/VerificationResult';
import MyVerifications from './pages/MyVerifications';
import { api, tokenStore } from './api/client';

export function App() {
  const [currentPage, setCurrentPage] = useState('login');
  const [user, setUser] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // The full response from POST /api/titles/verify - decision, scores,
  // findings, matched titles, explanation and the agent trace.
  const [verification, setVerification] = useState(null);

  useEffect(() => {
    const token = tokenStore.get();
    if (!token) {
      setIsCheckingAuth(false);
      return;
    }
    api.me()
      .then((data) => {
        setUser(data.user);
        setCurrentPage('dashboard');
      })
      .catch(() => {
        tokenStore.clear();
        setUser(null);
        setCurrentPage('login');
      })
      .finally(() => setIsCheckingAuth(false));
  }, []);

  const navigateTo = useCallback((page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    navigateTo('dashboard');
  };

  const handleRegisterSuccess = (userData) => {
    setUser(userData);
    navigateTo('email-verification');
  };

  const handleLogout = () => {
    tokenStore.clear();
    setUser(null);
    setVerification(null);
    navigateTo('login');
  };

  /** Called by Dashboard (fresh check) and MyVerifications (stored record). */
  const showVerification = (payload) => {
    setVerification(payload);
    navigateTo('verification-result');
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

  switch (currentPage) {
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
