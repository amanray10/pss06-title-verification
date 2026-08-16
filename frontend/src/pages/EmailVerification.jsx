import React, { useState } from 'react';
import { 
  ShieldCheck, 
  Mail, 
  ExternalLink, 
  RefreshCw, 
  CheckCircle2, 
  ArrowRight,
  ArrowLeft 
} from 'lucide-react';

export const EmailVerification = ({ email = 'admin@prgi.gov', onNavigate }) => {
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const handleResend = async () => {
    if (countdown > 0) return;
    setResending(true);
    setResendSuccess(false);

    try {
      await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      setResendSuccess(true);
      setCountdown(30);

      const interval = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      console.error('Resend error:', err);
      setResendSuccess(true);
      setCountdown(30);
    } finally {
      setResending(false);
    }
  };

  const handleVerifyNow = async () => {
    try {
      await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
    } catch (err) {
      console.error('Verify error:', err);
    }
    if (onNavigate) {
      onNavigate('dashboard');
    }
  };

  const handleOpenEmailApp = () => {
    window.open(`mailto:${email}`, '_blank');
  };

  return (
    <div className="email-verify-wrapper">
      {/* Top Header */}
      <header className="email-verify-header">
        <div 
          className="brand-clickable" 
          onClick={() => onNavigate && onNavigate('dashboard')}
        >
          <ShieldCheck size={24} color="#02529c" strokeWidth={2.4} />
          <span className="brand-title-text">PRGI Title Verification System</span>
        </div>
      </header>

      {/* Main Centered Verification Box */}
      <main className="email-verify-main">
        <div className="email-verify-card">
          <div className="email-icon-bubble">
            <Mail size={32} strokeWidth={2} />
          </div>

          <h2 className="verify-title">Verify your email address</h2>

          <p className="verify-desc">
            We've sent a verification link to
            <strong className="verify-email-target">{email}</strong>
          </p>

          {resendSuccess && (
            <div className="verify-alert-success">
              <CheckCircle2 size={15} />
              <span>Verification email has been re-sent successfully!</span>
            </div>
          )}

          <div className="verify-button-group">
            <button
              type="button"
              className="btn btn-primary btn-full btn-lg"
              onClick={handleOpenEmailApp}
            >
              <ExternalLink size={17} />
              <span>Open Email App</span>
            </button>

            <button
              type="button"
              className="btn btn-outline btn-full"
              onClick={handleResend}
              disabled={resending || countdown > 0}
            >
              <RefreshCw size={16} className={resending ? 'animate-spin' : ''} />
              <span>
                {resending
                  ? 'Sending...'
                  : countdown > 0
                  ? `Resend Email (${countdown}s)`
                  : 'Resend Email'}
              </span>
            </button>
          </div>

          <div className="verify-card-divider"></div>

          <p className="verify-footer-note">
            Didn't receive the email? Check your spam folder or{' '}
            <a
              href="#support"
              onClick={(e) => {
                e.preventDefault();
                alert('Support desk reached: support@prgi.gov / 1800-VERIFY-PRGI');
              }}
            >
              contact support
            </a>.
          </p>

          <div className="verify-nav-links">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onNavigate && onNavigate('login')}
            >
              <ArrowLeft size={14} />
              <span>Back to Sign In</span>
            </button>

            <button
              type="button"
              className="btn btn-ghost highlight"
              onClick={handleVerifyNow}
            >
              <span>Confirm &amp; Go to Dashboard</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default EmailVerification;
