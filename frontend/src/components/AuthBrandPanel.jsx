import React from 'react';
import { ShieldCheck, FileSpreadsheet, Shield } from 'lucide-react';

export const AuthBrandPanel = ({ variant = 'login' }) => {
  if (variant === 'create-account') {
    return (
      <div className="auth-brand-panel auth-brand-panel-register">
        <div className="auth-brand-pattern"></div>
        <div className="auth-brand-content">
          <div className="brand-badge-row">
            <div className="brand-shield-icon">
              <ShieldCheck size={28} color="#ffffff" strokeWidth={2.4} />
            </div>
            <span className="brand-logo-text">PRGI</span>
          </div>

          <h1 className="brand-hero-title">
            Title Verification System
          </h1>

          <p className="brand-hero-desc highlight-blue">
            Secure, transparent, and efficient registry access for verified administrators and officials.
          </p>
        </div>

        <div className="brand-panel-footer">
          Official Portal &bull; Ministry of Information &amp; Broadcasting &bull; Encrypted 256-bit SSL
        </div>
      </div>
    );
  }

  return (
    <div className="auth-brand-panel auth-brand-panel-login">
      <div className="auth-brand-pattern"></div>
      <div className="auth-brand-content">
        <div className="auth-secure-tag">
          <span className="dot"></span>
          <span className="dot"></span>
          <span>SECURE PORTAL</span>
        </div>

        <h1 className="brand-hero-title">
          Verify your publication title before submission.
        </h1>

        <p className="brand-hero-desc">
          Ensure compliance and uniqueness across the registry with real-time institutional verification.
        </p>

        <div className="brand-features-list">
          <div className="brand-feature-card">
            <div className="brand-feature-icon">
              <FileSpreadsheet size={19} />
            </div>
            <div>
              <h4 className="brand-feature-heading">Instant Cross-referencing</h4>
              <p className="brand-feature-body">
                Check against over 160,000 registered records instantaneously.
              </p>
            </div>
          </div>

          <div className="brand-feature-card">
            <div className="brand-feature-icon">
              <ShieldCheck size={19} />
            </div>
            <div>
              <h4 className="brand-feature-heading">State-level Authority</h4>
              <p className="brand-feature-body">
                Certified validation backed by governmental data anchors.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="brand-panel-footer">
        &copy; 2026 PRGI Title Verification System | Privacy Policy | Terms of Service | Ver. 4.5.1 (Secure)
      </div>
    </div>
  );
};

export default AuthBrandPanel;
