import { Resend } from 'resend'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const ALLOWED_SUBJECTS = new Set([
  'General Enquiry',
  'ZLTAC Registration',
  'Sponsorship',
  'Media',
  'Other',
])

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(3, '24 h'),
  prefix: 'ratelimit:contact',
  analytics: true,
})

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const forwarded = req.headers['x-forwarded-for']
  const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null)
    ?? req.socket?.remoteAddress
    ?? 'unknown'

  const { success, limit, remaining, reset } = await ratelimit.limit(ip)
  res.setHeader('X-RateLimit-Limit', limit)
  res.setHeader('X-RateLimit-Remaining', remaining)
  res.setHeader('X-RateLimit-Reset', reset)

  if (!success) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' })
  }

  const { name, email, subject, message, website } = req.body ?? {}

  // Honeypot — silently succeed if a bot filled the hidden field
  if (typeof website === 'string' && website.trim() !== '') {
    return res.status(200).json({ ok: true })
  }

  const nameTrim = typeof name === 'string' ? name.trim() : ''
  const emailTrim = typeof email === 'string' ? email.trim() : ''
  const subjectTrim = typeof subject === 'string' ? subject.trim() : ''
  const messageTrim = typeof message === 'string' ? message.trim() : ''

  if (!nameTrim) return res.status(400).json({ error: 'Name is required.' })
  if (nameTrim.length > 200) return res.status(400).json({ error: 'Name is too long.' })
  if (!emailTrim) return res.status(400).json({ error: 'Email is required.' })
  if (!EMAIL_REGEX.test(emailTrim)) return res.status(400).json({ error: 'Please enter a valid email address.' })
  if (!subjectTrim) return res.status(400).json({ error: 'Subject is required.' })
  if (!ALLOWED_SUBJECTS.has(subjectTrim)) return res.status(400).json({ error: 'Invalid subject.' })
  if (!messageTrim) return res.status(400).json({ error: 'Message is required.' })
  if (messageTrim.length < 10) return res.status(400).json({ error: 'Message is too short (10 characters minimum).' })
  if (messageTrim.length > 5000) return res.status(400).json({ error: 'Message is too long (5000 characters maximum).' })

  const oneLine = messageTrim.replace(/\s+/g, ' ').trim()
  const truncated = oneLine.length > 60 ? oneLine.slice(0, 60) + '...' : oneLine
  const emailSubject = `[ALSA Contact — ${subjectTrim}] ${truncated}`

  const submittedAt = new Date().toISOString()
  const text = [
    `Name: ${nameTrim}`,
    `Email: ${emailTrim}`,
    `Subject: ${subjectTrim}`,
    `Submitted: ${submittedAt}`,
    '',
    messageTrim,
  ].join('\n')

  const resend = new Resend(process.env.RESEND_API_KEY)
  try {
    const { error } = await resend.emails.send({
      from: 'ALSA Contact Form <noreply@lasersport.org.au>',
      to: ['committee@lasersport.org.au'],
      replyTo: emailTrim,
      subject: emailSubject,
      text,
    })
    if (error) {
      console.error('[api/contact] Resend error:', error)
      return res.status(500).json({ error: 'Could not send your message. Please try again or email committee@lasersport.org.au directly.' })
    }
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[api/contact] send threw:', err)
    return res.status(500).json({ error: 'Could not send your message. Please try again or email committee@lasersport.org.au directly.' })
  }
}
