export const READINESS_STATUS = Object.freeze({
  NOT_REQUIRED: 'not_required',
  ACTION_REQUIRED: 'action_required',
  PENDING_REVIEW: 'pending_review',
  SATISFIED: 'satisfied',
  REJECTED: 'rejected',
})

const { NOT_REQUIRED, ACTION_REQUIRED, PENDING_REVIEW, SATISFIED, REJECTED } = READINESS_STATUS

function result(status, source, detail = null) {
  return { status, source, ...(detail ? { detail } : {}) }
}

function overrideResult(override, fallback) {
  if (override?.value === true) {
    return result(SATISFIED, 'committee_override', {
      setAt: override.setAt ?? null,
      setBy: override.setBy ?? null,
      reason: override.reason ?? null,
    })
  }
  if (override?.value === false) {
    return result(REJECTED, 'committee_override', {
      setAt: override.setAt ?? null,
      setBy: override.setBy ?? null,
      reason: override.reason ?? null,
    })
  }
  return fallback
}

export function legalAcceptanceReadiness(activeDocument, acceptance) {
  if (!activeDocument?.id) return result(ACTION_REQUIRED, 'missing_active_document')
  if (!acceptance?.document_id) return result(ACTION_REQUIRED, 'not_accepted')

  if (acceptance.document_id === activeDocument.id) {
    const acceptedDigest = acceptance.content_sha256 ?? acceptance.document?.content_sha256 ?? null
    const activeDigest = activeDocument.content_sha256 ?? null
    if (activeDigest && !acceptedDigest) {
      return result(REJECTED, 'acceptance_digest_missing')
    }
    if (activeDigest && acceptedDigest && activeDigest !== acceptedDigest) {
      return result(REJECTED, 'content_digest_mismatch')
    }
    return result(SATISFIED, 'current_document')
  }

  // Reacceptance belongs to the newly published active version. A flag on an
  // older document described the transition to that old version and must not
  // make every later non-substantive version stale forever.
  if (activeDocument.requires_reacceptance) {
    return result(ACTION_REQUIRED, 'reacceptance_required')
  }

  return result(SATISFIED, 'prior_document_still_valid')
}

function teamReadiness(team) {
  if (team?.required === false) return result(NOT_REQUIRED, 'event_configuration')
  if (!team?.id) return result(ACTION_REQUIRED, 'team_missing')
  if (team.status === 'approved') return result(SATISFIED, 'team_status')
  if (team.status === 'pending' || team.status === 'submitted') {
    return result(PENDING_REVIEW, 'team_status')
  }
  if (team.status === 'rejected') return result(REJECTED, 'team_status')
  return result(ACTION_REQUIRED, 'team_status')
}

function under18Readiness(requirement, approval, override, activeDocument) {
  if (requirement === 'not_required') return result(NOT_REQUIRED, 'event_age')
  if (requirement !== 'required') {
    return overrideResult(override, result(ACTION_REQUIRED, 'invalid_or_missing_date_of_birth'))
  }

  if (!activeDocument?.id) {
    return overrideResult(override, result(ACTION_REQUIRED, 'missing_active_document'))
  }

  if (approval?.document_id && approval.document_id !== activeDocument.id
      && activeDocument.requires_reacceptance) {
    return overrideResult(override, result(ACTION_REQUIRED, 'reacceptance_required'))
  }

  if (approval && !approval.document_id) {
    return overrideResult(override, result(ACTION_REQUIRED, 'approval_document_missing'))
  }

  const real = approval?.status === 'approved'
    ? result(SATISFIED, 'committee_decision')
    : approval?.status === 'pending'
      ? result(PENDING_REVIEW, 'committee_decision')
      : approval?.status === 'rejected'
        ? result(REJECTED, 'committee_decision')
        : result(ACTION_REQUIRED, 'form_not_submitted')
  return overrideResult(override, real)
}

function paymentReadiness(required, amountOwingCents, amountPaidCents) {
  if (!required) return result(NOT_REQUIRED, 'event_configuration')
  if (!Number.isInteger(amountOwingCents) || amountOwingCents < 0
      || !Number.isInteger(amountPaidCents)) {
    return result(ACTION_REQUIRED, 'invalid_payment_ledger')
  }
  if (amountPaidCents >= amountOwingCents) {
    return result(SATISFIED, 'payment_ledger', {
      amountOwingCents,
      amountPaidCents,
      balanceCents: amountOwingCents - amountPaidCents,
    })
  }
  return result(ACTION_REQUIRED, amountPaidCents > 0 ? 'partially_paid' : 'unpaid', {
    amountOwingCents,
    amountPaidCents,
    balanceCents: amountOwingCents - amountPaidCents,
  })
}

/**
 * Canonical ZLTAC readiness calculation.
 *
 * The caller must fetch current-event rows and active legal documents through
 * the service-role API. This pure function keeps every consumer on the same
 * status vocabulary and separates player work, committee review, and final
 * event readiness.
 */
export function calculateZltacReadiness(input) {
  const registration = input?.registration ?? null
  const event = input?.event ?? {}
  const overrides = input?.overrides ?? {}
  const documents = input?.documents ?? {}
  const acceptances = input?.acceptances ?? {}

  const identity = !registration
    ? result(ACTION_REQUIRED, 'registration_missing')
    : registration.status === 'cancelled'
      ? result(REJECTED, 'registration_cancelled')
    : input.identity?.valid === true
      ? result(SATISFIED, 'registration_snapshot')
      : result(ACTION_REQUIRED, input.identity?.reason ?? 'identity_incomplete')

  const codeOfConduct = event.requireCodeOfConduct === false
    ? result(NOT_REQUIRED, 'event_configuration')
    : overrideResult(
      overrides.codeOfConduct,
      legalAcceptanceReadiness(documents.codeOfConduct, acceptances.codeOfConduct),
    )

  const mediaRelease = event.requireMediaRelease === false
    ? result(NOT_REQUIRED, 'event_configuration')
    : overrideResult(
      overrides.mediaRelease,
      legalAcceptanceReadiness(documents.mediaRelease, acceptances.mediaRelease),
    )

  const refereeTest = event.requireRefereeTest === false
    ? result(NOT_REQUIRED, 'event_configuration')
    : overrideResult(
      overrides.refereeTest,
      input.refereeTest?.passed === true
        ? result(SATISFIED, 'referee_result')
        : result(ACTION_REQUIRED, 'referee_test_not_passed'),
    )

  const sideEvents = event.requireSideEventConfirmation === false
    ? result(NOT_REQUIRED, 'event_configuration')
    : registration?.has_confirmed_side_events === true
        && input.sideEvents?.partnerRostersConfirmed === true
      ? result(SATISFIED, 'registration_confirmation')
      : result(ACTION_REQUIRED, 'side_events_not_confirmed')

  const extras = event.requireExtrasConfirmation === false
    ? result(NOT_REQUIRED, 'event_configuration')
    : registration?.has_confirmed_extras === true
      ? result(SATISFIED, 'registration_confirmation')
      : result(ACTION_REQUIRED, 'extras_not_confirmed')

  const checks = {
    identity,
    team: teamReadiness(input.team),
    code_of_conduct: codeOfConduct,
    media_release: mediaRelease,
    referee_test: refereeTest,
    side_events: sideEvents,
    extras,
    under_18: under18Readiness(
      input.under18?.requirement,
      input.under18?.approval,
      overrides.under18,
      documents.under18Form,
    ),
    payment: paymentReadiness(
      event.requirePayment !== false,
      registration?.amount_owing,
      input.payment?.amountPaidCents,
    ),
  }

  const statuses = Object.values(checks).map(check => check.status)
  const playerActionsComplete = statuses.every(status => (
    status === SATISFIED || status === NOT_REQUIRED || status === PENDING_REVIEW
  ))
  const awaitingCommittee = playerActionsComplete && statuses.includes(PENDING_REVIEW)
  const eventReady = statuses.every(status => status === SATISFIED || status === NOT_REQUIRED)

  return {
    checks,
    overall: {
      player_actions_complete: playerActionsComplete,
      awaiting_committee: awaitingCommittee,
      event_ready: eventReady,
      state: eventReady
        ? 'event_ready'
        : awaitingCommittee
          ? 'awaiting_committee'
          : 'action_required',
    },
  }
}
