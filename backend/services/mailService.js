/**
 * PSS06 - Outbound email (SMTP via nodemailer).
 *
 * Configuration lives in the single shared .env at the project root:
 *
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=587
 *   SMTP_SECURE=false
 *   SMTP_USER=ray10aman@gmail.com
 *   SMTP_PASS=<16-char Gmail App Password, no spaces>
 *   MAIL_FROM=PRGI Title Verification <ray10aman@gmail.com>
 *
 * Every send returns { sent, error, messageId } instead of throwing, so a mail
 * failure can never take down a review decision or a password reset. The
 * caller decides what to do when delivery does not work (for example, showing
 * the new password on screen).
 */

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false') === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
// Gmail shows app passwords as "abcd efgh ijkl mnop" - strip the spaces so a
// copy-paste from the Google page still works.
const SMTP_PASS = String(process.env.SMTP_PASS || '').replace(/\s+/g, '');
const MAIL_FROM = process.env.MAIL_FROM
  || (SMTP_USER ? `PRGI Title Verification <${SMTP_USER}>` : '');

let transporter = null;

export const mailEnabled = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

function getTransporter() {
  if (!mailEnabled) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,          // false for 587 (STARTTLS), true for 465
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { minVersion: 'TLSv1.2' }
  });
  return transporter;
}

/** Verify the SMTP credentials once at boot so problems surface immediately. */
export async function verifyMailer() {
  if (!mailEnabled) {
    return { ok: false, reason: 'SMTP is not configured in .env (SMTP_HOST / SMTP_USER / SMTP_PASS).' };
  }
  try {
    await getTransporter().verify();
    return { ok: true, user: SMTP_USER };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Send one message.
 * @returns {Promise<{sent: boolean, messageId?: string, error?: string}>}
 */
export async function sendMail({ to, subject, html, text }) {
  if (!to) return { sent: false, error: 'No recipient address.' };
  if (!mailEnabled) {
    return { sent: false, error: 'SMTP is not configured on the server.' };
  }
  try {
    const info = await getTransporter().sendMail({
      from: MAIL_FROM,
      to,
      subject,
      text: text || stripHtml(html || ''),
      html
    });

    // Gmail accepts-then-bounces, but a hard rejection at RCPT TO shows up here.
    const rejected = Array.isArray(info.rejected) ? info.rejected : [];
    if (rejected.length) {
      return { sent: false, error: `Address rejected by the mail server: ${rejected.join(', ')}` };
    }
    console.log(`[mail] sent "${subject}" -> ${to} (${info.messageId})`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[mail] FAILED "${subject}" -> ${to}:`, err.message);
    return { sent: false, error: err.message };
  }
}

function stripHtml(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h1|h2|h3)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function shell(innerHtml, accent = '#02529c') {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f7fb;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
        <tr><td style="background:${accent};padding:20px 28px;">
          <div style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:.2px;">
            PRGI &mdash; Press Registrar General of India
          </div>
          <div style="color:rgba(255,255,255,.82);font-size:12px;margin-top:3px;">
            Title Verification System (PSS06)
          </div>
        </td></tr>
        <tr><td style="padding:28px;color:#0f172a;font-size:14px;line-height:1.65;">
          ${innerHtml}
        </td></tr>
        <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 28px;color:#64748b;font-size:11.5px;line-height:1.5;">
          This is an automated message from the PRGI Title Verification System.
          Please do not reply to this address.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function passwordResetEmail({ name, password }) {
  return {
    subject: 'PRGI Title Verification - Your new password',
    html: shell(`
      <p style="margin:0 0 14px 0;">Dear ${escapeHtml(name || 'Applicant')},</p>
      <p style="margin:0 0 16px 0;">
        A password reset was requested for your PRGI Title Verification account.
        Your password has been reset. Please sign in using the temporary password below.
      </p>
      <div style="margin:20px 0;padding:18px 20px;background:#f1f5f9;border:1px dashed #94a3b8;border-radius:10px;text-align:center;">
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#64748b;font-weight:700;">
          Temporary password
        </div>
        <div style="font-size:22px;font-weight:800;letter-spacing:2px;color:#02529c;margin-top:8px;font-family:Consolas,Menlo,monospace;">
          ${escapeHtml(password)}
        </div>
      </div>
      <p style="margin:0 0 8px 0;">
        For your security, change this password after signing in. If you did not
        request this reset, contact the PRGI administrator immediately &mdash; your
        previous password no longer works.
      </p>
    `)
  };
}

export function decisionEmail({ name, title, applicationRef, accepted, reason, reviewedBy, decidedAt }) {
  const accent = accepted ? '#15803d' : '#b91c1c';
  const word = accepted ? 'ACCEPTED' : 'REJECTED';
  const lead = accepted
    ? `Following manual review by a PRGI verification officer, your title has been <strong>accepted</strong>.`
    : `Following manual review by a PRGI verification officer, your title has been <strong>rejected</strong>.`;
  const tail = accepted
    ? `The title is now recorded against your application and will block conflicting submissions by other applicants.`
    : `You may submit a revised title through the verification portal. The officer's reason above explains what needs to change.`;

  return {
    subject: `Title ${word.toLowerCase()} after manual review - "${title}" (${applicationRef})`,
    html: shell(`
      <p style="margin:0 0 14px 0;">Dear ${escapeHtml(name || 'Applicant')},</p>
      <p style="margin:0 0 18px 0;">${lead}</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin:0 0 18px 0;">
        <tr>
          <td style="background:${accent};color:#ffffff;padding:12px 18px;font-weight:800;letter-spacing:1px;font-size:13px;">
            DECISION: ${word}
          </td>
        </tr>
        ${row('Title', title)}
        ${row('Application reference', applicationRef)}
        ${row('Reviewed by', reviewedBy || 'PRGI Administrator')}
        ${row('Decided on', decidedAt || new Date().toLocaleString('en-IN'))}
      </table>

      <div style="margin:0 0 18px 0;padding:14px 16px;background:#f8fafc;border-left:4px solid ${accent};border-radius:0 8px 8px 0;">
        <div style="font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:#64748b;font-weight:700;margin-bottom:6px;">
          Officer's reason
        </div>
        <div style="color:#0f172a;">${escapeHtml(reason || 'No reason recorded.')}</div>
      </div>

      <p style="margin:0;">${tail}</p>
    `, accent)
  };
}

function row(label, value) {
  return `<tr>
    <td style="padding:10px 18px;border-top:1px solid #e2e8f0;">
      <span style="display:inline-block;min-width:170px;color:#64748b;font-size:12.5px;">${escapeHtml(label)}</span>
      <strong style="color:#0f172a;">${escapeHtml(String(value ?? '-'))}</strong>
    </td></tr>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default { sendMail, verifyMailer, mailEnabled, passwordResetEmail, decisionEmail };
