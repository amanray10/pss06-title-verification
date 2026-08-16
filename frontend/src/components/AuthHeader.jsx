import React, { useState } from 'react';
import { ShieldCheck, Bell, Settings, User, CheckCircle2 } from 'lucide-react';

export const AuthHeader = ({ onNavigate }) => {
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <header className="auth-header">
      <div 
        className="auth-header-brand" 
        onClick={() => onNavigate && onNavigate('dashboard')}
        style={{ cursor: 'pointer' }}
      >
        <div className="auth-header-logo">
          <ShieldCheck size={24} color="#02529c" strokeWidth={2.4} />
        </div>
        <span className="auth-header-title">PRGI Title Verification System</span>
      </div>

      <nav className="auth-header-nav">
        <button 
          type="button" 
          className="nav-text-link"
          onClick={() => alert('Official PRGI Title Verification Support & Help Center')}
        >
          Help
        </button>
        <button 
          type="button" 
          className="nav-text-link"
          onClick={() => alert('PRGI Title Verification System v4.5.1')}
        >
          About
        </button>

        <div className="header-action-relative">
          <button 
            type="button" 
            className="nav-icon-button"
            title="Notifications"
            onClick={() => setShowNotifications(!showNotifications)}
          >
            <Bell size={18} />
          </button>

          {showNotifications && (
            <div className="notifications-dropdown">
              <div className="dropdown-title">System Status</div>
              <div className="dropdown-item">
                <CheckCircle2 size={15} color="#10b981" />
                <span>Verification registries fully operational.</span>
              </div>
            </div>
          )}
        </div>

        <button 
          type="button" 
          className="nav-icon-button"
          title="Settings"
          onClick={() => alert('Settings can be configured inside the Dashboard.')}
        >
          <Settings size={18} />
        </button>

        <button 
          type="button" 
          className="nav-avatar-button"
          title="User Account"
          onClick={() => onNavigate && onNavigate('dashboard')}
        >
          <User size={16} />
        </button>
      </nav>
    </header>
  );
};

export default AuthHeader;
