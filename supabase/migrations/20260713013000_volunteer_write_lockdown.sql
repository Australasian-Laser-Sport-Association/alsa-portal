-- Wave A: volunteer mutations are server-authoritative.
--
-- api/volunteer-signup.js and the admin volunteer route already use the
-- service-role client. Keep authenticated SELECT for the existing owner/read
-- policies, but remove every browser write privilege from the volunteer
-- tables. The REVOKEs are intentionally repeated for configuration tables so
-- migration drift cannot silently expose their committee policies.

BEGIN;

REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.volunteer_roles
  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.event_volunteer_settings
  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.volunteer_signups
  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.volunteer_signup_roles
  FROM authenticated;

COMMIT;
