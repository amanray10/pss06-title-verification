import React, { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import {
  Mail, Lock, ArrowRight, Building2, Check, AlertCircle,
  X, KeyRound, Send, Copy, CheckCircle2
} from 'lucide-react';
import AuthHeader from '../components/AuthHeader';
import AuthBrandPanel from '../components/AuthBrandPanel';
import FormInput from '../components/FormInput';
import { api, tokenStore } from '../api/client';

export const Login = ({ onNavigate, onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // --- forgot-password modal state ----------------------------------------
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const [forgotResult, setForgotResult] = useState(null); // { delivered, message, password }
  const [copied, setCopied] = useState(false);

  const openForgot = () => {
    setForgotEmail(email || '');
    setForgotError('');
    setForgotResult(null);
    setCopied(false);
    setForgotOpen(true);
  };

  const closeForgot = () => {
    setForgotOpen(false);
    setForgotBusy(false);
    setForgotError('');
    setForgotResult(null);
  };

  const handleForgotSubmit = async (e) => {
    e?.preventDefault();
    setForgotError('');

    const addr = forgotEmail.trim();
    if (!addr) {
      setForgotError('Please enter your registered email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addr)) {
      setForgotError('Please enter a valid email address.');
      return;
    }

    setForgotBusy(true);
    try {
      const data = await api.forgotPassword(addr);
      setForgotResult({
        delivered: Boolean(data.delivered),
        message: data.message,
        password: data.password || null
      });
    } catch (err) {
      setForgotError(err.message || 'Password reset failed. Please try again.');
    } finally {
      setForgotBusy(false);
    }
  };

  const handleGoogleLogin = useGoogleLogin({
    scope: 'email profile openid',
    onSuccess: async (tokenResponse) => {
      setLoading(true);
      setErrorMsg('');
      try {
        if (!tokenResponse?.access_token) {
          throw new Error('No access token received from Google.');
        }

        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
        });

        if (!userInfoRes.ok) {
          throw new Error(`Google UserInfo API returned ${userInfoRes.status}`);
        }

        const profile = await userInfoRes.json();
        
        if (!profile?.email) {
          throw new Error('Google did not provide an email address.');
        }

        const data = await api.googleLogin(null, {
          email: profile.email,
          name: profile.name || profile.given_name || profile.email.split('@')[0]
        });

        if (data.success && data.user) {
          if (data.token) {
            tokenStore.set(data.token);
          }
          if (onLoginSuccess) {
            onLoginSuccess(data.user);
          } else if (onNavigate) {
            onNavigate('dashboard');
          }
        } else {
          setErrorMsg(data.message || 'Google authentication failed.');
        }
      } catch (err) {
        console.error('Google login error:', err);
        setErrorMsg(err.message || 'Failed to complete Google Sign-In.');
      } finally {
        setLoading(false);
      }
    },
    onError: (error) => {
      console.error('Google login error:', error);
      const detail = error?.error_description || error?.error || 'Authorization cancelled or origin mismatch.';
      setErrorMsg(`Google Sign-In failed: ${detail}`);
    }
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMsg(data.message || 'Invalid email or password.');
        setLoading(false);
        return;
      }

      if (data.token) {
        localStorage.setItem('prgi_token', data.token);
      }

      if (onLoginSuccess) {
        onLoginSuccess(data.user);
      } else if (onNavigate) {
        onNavigate('dashboard');
      }
    } catch (err) {
      console.error('Login fetch error:', err);
      setErrorMsg('Failed to connect to authentication server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page-container">
      <AuthHeader onNavigate={onNavigate} />

      <main className="auth-split-layout">
        {/* Left Side Branding */}
        <AuthBrandPanel variant="login" />

        {/* Right Side Form */}
        <div className="auth-form-column">
          <div className="auth-form-card">
            <h2 className="auth-card-heading">Welcome back</h2>
            <p className="auth-card-subheading">
              Sign in to access your verification dashboard.
            </p>

            {errorMsg && (
              <div style={{
                backgroundColor: '#fef2f2',
                color: '#dc2626',
                border: '1px solid #fecaca',
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '14px'
              }}>
                <AlertCircle size={16} />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="auth-form-fields">
              <FormInput
                label="Email Address"
                type="email"
                name="email"
                placeholder="name@institution.gov or admin@prgi.gov"
                value={email}
                onChange={(e) => {
                  setErrorMsg('');
                  setEmail(e.target.value);
                }}
                iconLeft={<Mail size={16} />}
                required
              />

              <FormInput
                label="Password"
                type="password"
                name="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => {
                  setErrorMsg('');
                  setPassword(e.target.value);
                }}
                iconLeft={<Lock size={16} />}
                labelRightLink={{
                  text: 'Forgot password',
                  onClick: openForgot
                }}
                required
              />

              <div className="remember-row">
                <label className="custom-checkbox-label">
                  <input
                    type="checkbox"
                    className="custom-checkbox-input"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <div className="custom-checkbox-box">
                    {rememberMe && <Check size={12} color="#ffffff" strokeWidth={3} />}
                  </div>
                  <span>Remember me for 30 days</span>
                </label>
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-full btn-lg"
                disabled={loading}
              >
                {loading ? 'Verifying with Bcrypt...' : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight size={17} strokeWidth={2.2} />
                  </>
                )}
              </button>

              <div className="auth-separator">
                <span>Or continue with</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  type="button"
                  className="btn btn-outline btn-full btn-google"
                  onClick={() => handleGoogleLogin()}
                  disabled={loading}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </button>

                <button
                  type="button"
                  className="btn btn-outline btn-full btn-sso"
                  onClick={() => {
                    onNavigate && onNavigate('admin-login');
                  }}
                >
                  <Building2 size={18} color="#02529c" />
                  <span>Login as Admin</span>
                </button>
              </div>

              <p className="auth-bottom-text">
                Don't have an account?{' '}
                <a
                  href="#create-account"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate && onNavigate('create-account');
                  }}
                >
                  Contact Administrator / Register
                </a>
              </p>
            </form>
          </div>
        </div>
      </main>

      {/* ------------------------------------------------------------------ */}
      {/* Forgot password                                                     */}
      {/* ------------------------------------------------------------------ */}
      {forgotOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget && !forgotBusy) closeForgot(); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
            backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div style={{
            width: '100%', maxWidth: '460px',
            backgroundColor: '#ffffff', borderRadius: '16px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 24px 60px rgba(12, 30, 61, 0.28)',
            overflow: 'hidden'
          }}>
            {/* header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '20px 24px', borderBottom: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc'
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                backgroundColor: '#e0edfa', color: '#02529c',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
              }}>
                <KeyRound size={19} strokeWidth={2.2} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 800, color: '#0f172a' }}>
                  Reset your password
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                  We will email a new password to your registered address.
                </p>
              </div>
              <button
                type="button"
                onClick={closeForgot}
                disabled={forgotBusy}
                aria-label="Close"
                style={{
                  border: 'none', background: 'transparent', cursor: forgotBusy ? 'default' : 'pointer',
                  color: '#94a3b8', padding: 4, borderRadius: 6, lineHeight: 0
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* body */}
            <div style={{ padding: '22px 24px 24px 24px' }}>
              {!forgotResult ? (
                <form onSubmit={handleForgotSubmit}>
                  <label style={{
                    display: 'block', fontSize: '0.78rem', fontWeight: 700,
                    color: '#334155', marginBottom: 7, letterSpacing: '.2px'
                  }}>
                    Registered Email Address
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Mail
                      size={16}
                      style={{
                        position: 'absolute', left: 12, top: '50%',
                        transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none'
                      }}
                    />
                    <input
                      type="email"
                      autoFocus
                      value={forgotEmail}
                      onChange={(e) => { setForgotError(''); setForgotEmail(e.target.value); }}
                      placeholder="name@institution.gov"
                      disabled={forgotBusy}
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '11px 13px 11px 36px',
                        border: `1px solid ${forgotError ? '#fca5a5' : '#cbd5e1'}`,
                        borderRadius: 9, fontSize: '0.88rem', color: '#0f172a',
                        outline: 'none', backgroundColor: forgotBusy ? '#f8fafc' : '#ffffff'
                      }}
                    />
                  </div>

                  {forgotError && (
                    <div style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      marginTop: 12, padding: '10px 12px',
                      backgroundColor: '#fef2f2', border: '1px solid #fecaca',
                      borderRadius: 8, color: '#dc2626',
                      fontSize: '0.79rem', fontWeight: 600, lineHeight: 1.45
                    }}>
                      <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>{forgotError}</span>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={closeForgot}
                      disabled={forgotBusy}
                      style={{ flex: '0 0 auto' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={forgotBusy}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                    >
                      {forgotBusy ? 'Sending new password...' : (
                        <>
                          <Send size={16} strokeWidth={2.2} />
                          <span>Send New Password</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                <div>
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '12px 14px', borderRadius: 9,
                    backgroundColor: forgotResult.delivered ? '#f0fdf4' : '#fffbeb',
                    border: `1px solid ${forgotResult.delivered ? '#bbf7d0' : '#fde68a'}`,
                    color: forgotResult.delivered ? '#15803d' : '#92400e',
                    fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.5
                  }}>
                    {forgotResult.delivered
                      ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                      : <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
                    <span>{forgotResult.message}</span>
                  </div>

                  {forgotResult.password && (
                    <div style={{
                      marginTop: 16, padding: '16px 18px',
                      backgroundColor: '#f1f5f9', border: '1px dashed #94a3b8',
                      borderRadius: 10, textAlign: 'center'
                    }}>
                      <div style={{
                        fontSize: '0.66rem', letterSpacing: '1px', textTransform: 'uppercase',
                        color: '#64748b', fontWeight: 800
                      }}>
                        Your new password
                      </div>
                      <div style={{
                        fontFamily: 'Consolas, Menlo, monospace', fontSize: '1.25rem',
                        fontWeight: 800, letterSpacing: '1.5px', color: '#02529c', margin: '8px 0 12px 0',
                        wordBreak: 'break-all'
                      }}>
                        {forgotResult.password}
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => {
                          navigator.clipboard?.writeText(forgotResult.password);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '0.8rem' }}
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        <span>{copied ? 'Copied' : 'Copy password'}</span>
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn btn-primary btn-full"
                    onClick={() => {
                      if (forgotEmail.trim()) setEmail(forgotEmail.trim());
                      closeForgot();
                    }}
                    style={{ marginTop: 18 }}
                  >
                    Back to Sign In
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;
