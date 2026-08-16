import React, { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { Mail, Lock, ArrowRight, Building2, Check, AlertCircle } from 'lucide-react';
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
    </div>
  );
};

export default Login;
