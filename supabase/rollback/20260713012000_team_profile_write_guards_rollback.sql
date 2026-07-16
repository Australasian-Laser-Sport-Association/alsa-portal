-- ROLL_FORWARD_ONLY_SECURITY_BOUNDARY
-- Removing these guards would reopen team ownership/status escalation and
-- profile email or post-registration DOB poisoning.
DO $$
BEGIN
  RAISE EXCEPTION
    '12000 is a security boundary and has no safe rollback. Keep it applied and roll forward.';
END;
$$;
