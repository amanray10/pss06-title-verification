import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export const FormInput = ({
  label,
  type = 'text',
  name,
  value,
  onChange,
  placeholder,
  required = false,
  iconLeft,
  labelRightLink,
  strength,
  error
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const effectiveType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className="form-group">
      <div className="form-label-row">
        {label && (
          <label className="form-label" htmlFor={name}>
            {label}
          </label>
        )}
        {labelRightLink && (
          <a
            href="#action"
            onClick={(e) => {
              e.preventDefault();
              labelRightLink.onClick?.();
            }}
            className="form-link"
          >
            {labelRightLink.text}
          </a>
        )}
      </div>

      <div className="input-wrapper">
        {iconLeft && <div className="input-icon-left">{iconLeft}</div>}

        <input
          id={name}
          name={name}
          type={effectiveType}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          className={`form-input ${iconLeft ? 'has-icon-left' : ''} ${
            isPassword ? 'has-icon-right' : ''
          }`}
        />

        {isPassword && (
          <button
            type="button"
            className="input-action-right"
            onClick={() => setShowPassword(!showPassword)}
            title={showPassword ? 'Hide password' : 'Show password'}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>

      {strength && (
        <div className="password-strength-container">
          <div className="password-strength-bars">
            <div className={`strength-bar ${strength.level >= 1 ? strength.class : ''}`}></div>
            <div className={`strength-bar ${strength.level >= 2 ? strength.class : ''}`}></div>
            <div className={`strength-bar ${strength.level >= 3 ? strength.class : ''}`}></div>
            <div className={`strength-bar ${strength.level >= 4 ? strength.class : ''}`}></div>
          </div>
          <span className="password-strength-label">{strength.label}</span>
        </div>
      )}

      {error && <span className="form-error-msg">{error}</span>}
    </div>
  );
};

export default FormInput;
