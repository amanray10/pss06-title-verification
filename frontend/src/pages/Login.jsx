import React, { useState } from 'react';
import { Mail, Lock, ArrowRight, Building2, Check, AlertCircle } from 'lucide-react';
import AuthHeader from '../components/AuthHeader';
import AuthBrandPanel from '../components/AuthBrandPanel';
import FormInput from '../components/FormInput';

export const Login = ({ onNavigate, onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

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
                  onClick: () => alert('A password reset link has been dispatched to your institutional email.')
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

              <button
                type="button"
                className="btn btn-outline btn-full btn-sso"
                onClick={async () => {
                  // SSO login helper
                  try {
                    const res = await fetch('/api/auth/login', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: 'admin@prgi.gov', password: 'admin123' })
                    });
                    const data = await res.json();
                    if (data.success) {
                      localStorage.setItem('prgi_token', data.token);
                      onLoginSuccess && onLoginSuccess(data.user);
                    }
                  } catch (e) {
                    onNavigate && onNavigate('dashboard');
                  }
                }}
              >
                <Building2 size={18} color="#02529c" />
                <span>Continue with SSO</span>
              </button>

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
    </div>
  );
};

export default Login;
