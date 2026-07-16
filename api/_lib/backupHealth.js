const HOUR_MS = 60 * 60 * 1000

export function backupScheduleHealth(settings, now = new Date()) {
  if (!settings || settings.frequency === 'off') {
    return { status: 'disabled', stale: false, maxAgeHours: null }
  }

  const maxAgeHours = settings.frequency === 'weekly' ? 8 * 24 : 36
  const lastRun = settings.last_backup_at ? new Date(settings.last_backup_at) : null
  const lastRunTime = lastRun?.getTime()
  if (!Number.isFinite(lastRunTime)) {
    return {
      status: 'never_completed',
      stale: true,
      maxAgeHours,
      message: 'No successful backup run has been recorded.',
    }
  }

  const ageHours = Math.max(0, (now.getTime() - lastRunTime) / HOUR_MS)
  const failed = /^failed\b/i.test(String(settings.last_backup_status ?? '').trim())
  if (failed) {
    return {
      status: 'failed',
      stale: true,
      ageHours,
      maxAgeHours,
      message: `The last backup attempt failed: ${settings.last_backup_status}`,
    }
  }
  if (ageHours > maxAgeHours) {
    return {
      status: 'stale',
      stale: true,
      ageHours,
      maxAgeHours,
      message: `The last recorded backup is ${Math.floor(ageHours)} hours old.`,
    }
  }

  return { status: 'healthy', stale: false, ageHours, maxAgeHours }
}
