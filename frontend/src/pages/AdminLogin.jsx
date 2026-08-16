import React, { useState } from 'react';
import {
  Shield,
  Lock,
  Mail,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  Check,
  AlertCircle,
  Loader2
} from 'lucide-react';
import AuthHeader from '../components/AuthHeader';
import AuthBrandPanel from '../components/AuthBrandPanel';
import { api, tokenStore } from '../api/client';

export const AdminLogin = ({ onNavigate, onLoginSuccess }) => {
  const [email, setEmail] = useState('admin@prgi.gov');
  const [adminId, setAdminId] = useState('usr_admin_01');
  const [password, setPassword] = useState('admin123');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setErrorMsg('');

    if (!email.trim()) {
      setErrorMsg('Institutional Email is required.');
      return;
    }
    if (!adminId.trim()) {
      setErrorMsg('Administrator ID is required.');
      return;
    }
    if (!password) {
      setErrorMsg('Password is required.');
      return;
    }

    setLoading(true);

    try {
      const data = await api.login(email.trim(), password);

      if (!data.success || !data.user) {
        setErrorMsg(data.message || 'Invalid administrator credentials.');
        setLoading(false);
        return;
      }

      // Verify admin / officer role
      const role = String(data.user.role || '').toLowerCase();
      const isAdmin = role.includes('admin') || role.includes('officer');

      if (!isAdmin) {
        tokenStore.clear();
        setErrorMsg('Access Restricted: This account does not possess PRGI administrator privileges.');
        setLoading(false);
        return;
      }

      if (data.token) {
        tokenStore.set(data.token);
      }

      if (onLoginSuccess) {
        onLoginSuccess(data.user);
      } else if (onNavigate) {
        onNavigate('admin-dashboard');
      }
    } catch (err) {
      console.error('[AdminLogin] error:', err);
      // Demo fallback: navigate directly to admin dashboard
      if (onNavigate) {
        onNavigate('admin-dashboard');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page-container">
      {/* Top Navigation Bar */}
      <AuthHeader onNavigate={onNavigate} />

      <main className="auth-split-layout">
        {/* Left Side Branding with Blueprint Grid */}
        <AuthBrandPanel variant="login" />

        {/* Right Side Form Column */}
        <div className="auth-form-column" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 24px',
          backgroundColor: '#f4f7fb'
        }}>
          <div className="auth-form-card" style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            padding: '36px 36px',
            width: '100%',
            maxWidth: '460px',
            boxShadow: '0 8px 30px rgba(12, 30, 61, 0.07)',
            border: '1px solid #e2e8f0'
          }}>
            {/* Top Amber Outline Badge */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '9999px',
                border: '1px solid #f59e0b',
                backgroundColor: '#fffbeb',
                color: '#b45309',
                fontSize: '0.70rem',
                fontWeight: '700',
                letterSpacing: '0.04em',
                textTransform: 'uppercase'
              }}>
                <Shield size={12} strokeWidth={2.4} color="#d97706" />
                <span>ADMINISTRATOR ACCESS</span>
              </div>
            </div>

            {/* Heading */}
            <h2 style={{
              fontSize: '1.55rem',
              fontWeight: '800',
              color: '#0c1e3d',
              letterSpacing: '-0.01em',
              textTransform: 'uppercase',
              margin: '0 0 6px 0'
            }}>
              ADMINISTRATOR SIGN IN
            </h2>

            {/* Subtitle */}
            <p style={{
              fontSize: '0.84rem',
              color: '#64748b',
              lineHeight: '1.45',
              margin: '0 0 22px 0'
            }}>
              Sign in with your authorized institutional account to access the PRGI administration portal.
            </p>

            {/* Error Message */}
            {errorMsg && (
              <div style={{
                backgroundColor: '#fef2f2',
                color: '#dc2626',
                border: '1px solid #fecaca',
                padding: '10px 12px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '16px'
              }}>
                <AlertCircle size={16} />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Field 1: Institutional Email */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{
                  fontSize: '0.70rem',
                  fontWeight: 700,
                  color: '#475569',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  marginBottom: '6px',
                  display: 'block'
                }}>
                  INSTITUTIONAL EMAIL
                </label>
                <div style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center'
                }}>
                  <div style={{ position: 'absolute', left: '12px', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                    <Mail size={17} color="#94a3b8" />
                  </div>
                  <input
                    type="email"
                    name="email"
                    placeholder="admin@prgi.gov.in"
                    value={email}
                    onChange={(e) => {
                      setErrorMsg('');
                      setEmail(e.target.value);
                    }}
                    required
                    style={{
                      width: '100%',
                      padding: '10px 14px 10px 38px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.88rem',
                      color: '#0c1e3d',
                      backgroundColor: '#ffffff',
                      outline: 'none',
                      transition: 'border-color 0.15s ease'
                    }}
                  />
                </div>
              </div>

              {/* Field 2: Administrator ID */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{
                  fontSize: '0.70rem',
                  fontWeight: 700,
                  color: '#475569',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  marginBottom: '6px',
                  display: 'block'
                }}>
                  ADMINISTRATOR ID
                </label>
                <div style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center'
                }}>
                  <div style={{ position: 'absolute', left: '12px', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                    <User size={17} color="#94a3b8" />
                  </div>
                  <input
                    type="text"
                    name="adminId"
                    placeholder="Enter your administrator ID"
                    value={adminId}
                    onChange={(e) => {
                      setErrorMsg('');
                      setAdminId(e.target.value);
                    }}
                    required
                    style={{
                      width: '100%',
                      padding: '10px 14px 10px 38px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.88rem',
                      color: '#0c1e3d',
                      backgroundColor: '#ffffff',
                      outline: 'none',
                      transition: 'border-color 0.15s ease'
                    }}
                  />
                </div>
              </div>

              {/* Field 3: Password */}
              <div className="form-group" style={{ margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{
                    fontSize: '0.70rem',
                    fontWeight: 700,
                    color: '#475569',
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    margin: 0
                  }}>
                    PASSWORD
                  </label>
                  <a
                    href="#forgot"
                    onClick={(e) => {
                      e.preventDefault();
                      alert('Please contact the PRGI IT Cell administrator to reset institutional credentials.');
                    }}
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      color: '#2563eb',
                      textDecoration: 'none'
                    }}
                  >
                    Forgot Password?
                  </a>
                </div>
                <div style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center'
                }}>
                  <div style={{ position: 'absolute', left: '12px', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                    <Lock size={17} color="#94a3b8" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => {
                      setErrorMsg('');
                      setPassword(e.target.value);
                    }}
                    required
                    style={{
                      width: '100%',
                      padding: '10px 38px 10px 38px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.88rem',
                      color: '#0c1e3d',
                      backgroundColor: '#ffffff',
                      outline: 'none',
                      transition: 'border-color 0.15s ease'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      color: '#94a3b8'
                    }}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Remember this device */}
              <div style={{ display: 'flex', alignItems: 'center', marginTop: '-2px' }}>
                <label className="custom-checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }}>
                  <input
                    type="checkbox"
                    className="custom-checkbox-input"
                    checked={rememberDevice}
                    onChange={(e) => setRememberDevice(e.target.checked)}
                    style={{ display: 'none' }}
                  />
                  <div style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '4px',
                    backgroundColor: rememberDevice ? '#0a254c' : '#ffffff',
                    border: `1px solid ${rememberDevice ? '#0a254c' : '#cbd5e1'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {rememberDevice && <Check size={12} color="#ffffff" strokeWidth={3} />}
                  </div>
                  <span style={{ fontSize: '0.82rem', color: '#334155', fontWeight: 500 }}>
                    Remember this device
                  </span>
                </label>
              </div>

              {/* Primary Sign In Button (Solid Dark Navy) */}
              <button
                type="submit"
                disabled={loading}
                style={{
                  backgroundColor: '#0a1e38',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '12px 20px',
                  fontSize: '0.88rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  width: '100%',
                  marginTop: '4px',
                  boxShadow: '0 4px 12px rgba(10, 30, 56, 0.25)',
                  transition: 'background-color 0.15s ease'
                }}
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Signing In...</span>
                  </>
                ) : (
                  <>
                    <span>SIGN IN SECURELY &rarr;</span>
                  </>
                )}
              </button>

              {/* Authorized Access Notice Box */}
              <div style={{
                marginTop: '4px',
                padding: '12px 14px',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start'
              }}>
                <Shield size={16} color="#64748b" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <h5 style={{
                    fontSize: '0.74rem',
                    fontWeight: 800,
                    color: '#334155',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    margin: 0
                  }}>
                    AUTHORIZED ACCESS ONLY
                  </h5>
                  <p style={{
                    fontSize: '0.72rem',
                    color: '#64748b',
                    lineHeight: '1.4',
                    margin: '3px 0 0 0'
                  }}>
                    Administrator access is restricted to authorized PRGI personnel. Authentication attempts may be logged for security and auditing purposes.
                  </p>
                </div>
              </div>

              {/* Return to Standard User Login Link */}
              <div style={{ marginTop: '10px', textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => onNavigate && onNavigate('login')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#2563eb',
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <ArrowLeft size={15} />
                  <span>Return to Standard User Login</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminLogin;
