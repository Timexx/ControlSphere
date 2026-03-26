/**
 * Email sending service for ControlSphere notifications.
 * Wraps nodemailer with SecretEncryptionService for SMTP password handling.
 */

import { prisma } from './prisma'
import { SecretEncryptionService } from '../infrastructure/crypto/SecretEncryptionService'

import nodemailer from 'nodemailer'

export interface SmtpConfig {
  smtpHost: string
  smtpPort: number
  smtpUsername?: string | null
  smtpPassword?: string | null  // may be encrypted
  smtpFromEmail: string
  smtpFromName: string
  smtpTls: boolean
  smtpVerifyCert: boolean
}

export interface SendEmailOpts {
  to: string | string[]
  subject: string
  html: string
  text: string
  machineId?: string
  eventKey?: string
}

function getEncryptionService(): SecretEncryptionService {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET not set — cannot decrypt SMTP password')
  return new SecretEncryptionService(secret)
}

function decryptPassword(raw: string): string {
  const svc = getEncryptionService()
  if (svc.isEncrypted(raw)) {
    return svc.decrypt(raw)
  }
  return raw
}

export function encryptPassword(plain: string): string {
  return getEncryptionService().encrypt(plain)
}

function buildTransporter(config: SmtpConfig): nodemailer.Transporter {
  const password = config.smtpPassword ? decryptPassword(config.smtpPassword) : undefined

  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    requireTLS: config.smtpTls && config.smtpPort !== 465,
    tls: {
      rejectUnauthorized: config.smtpVerifyCert,
    },
    auth: config.smtpUsername
      ? { user: config.smtpUsername, pass: password }
      : undefined,
  })
}

/**
 * Send an email and log the result to NotificationLog.
 */
export async function sendEmail(config: SmtpConfig, opts: SendEmailOpts): Promise<void> {
  const recipients = Array.isArray(opts.to) ? opts.to.join(', ') : opts.to
  let status: 'sent' | 'failed' = 'failed'
  let error: string | undefined

  try {
    const transporter = buildTransporter(config)
    await transporter.sendMail({
      from: `"${config.smtpFromName}" <${config.smtpFromEmail}>`,
      to: recipients,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    })
    status = 'sent'
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    console.error('[email] Failed to send email:', error)
    throw err
  } finally {
    try {
      await prisma.notificationLog.create({
        data: {
          event:      opts.eventKey || 'unknown',
          subject:    opts.subject,
          recipients,
          status,
          error:      error ?? null,
          machineId:  opts.machineId ?? null,
        },
      })
    } catch (logErr) {
      console.error('[email] Failed to write notification log:', logErr)
    }
  }
}

/**
 * Test SMTP connectivity without sending an email.
 * Returns null on success, or an error message string on failure.
 */
export async function testSmtpConnection(config: SmtpConfig): Promise<string | null> {
  try {
    const transporter = buildTransporter(config)
    await transporter.verify()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
