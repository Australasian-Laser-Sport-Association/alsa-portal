-- Minimise authenticated browser access to identity, payment, legal, and
-- administrative data. Browser discovery uses masked views; privileged and
-- cross-user reads use vetted service-role APIs.

BEGIN;

-- Adding only public configuration columns at the end preserves the deployed
-- view contract while removing the last reason for a browser to read the event
-- base table. Bank instructions and payments_override are deliberately absent.
CREATE OR REPLACE VIEW public.public_zltac_events
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  event.id,
  event.name,
  event.year,
  event.location,
  event.venue,
  event.start_date,
  event.end_date,
  event.status,
  event.description,
  event.logo_url,
  event.side_events,
  event.reg_open_date,
  event.reg_close_date,
  event.event_starts_at,
  event.timezone,
  event.committee_email,
  event.hero_text,
  event.photo_urls,
  event.cover_photo_url,
  event.main_fee,
  event.team_fee,
  event.dinner_guest_price,
  event.processing_fee_pct,
  event.require_coc,
  event.require_ref_test,
  event.require_payment,
  event.max_teams,
  event.max_players,
  event.max_players_per_team,
  event.allow_side_events_only,
  event.enable_waitlist
FROM public.zltac_events AS event
WHERE event.status IN ('open', 'closed', 'archived')
   OR public.is_committee();

REVOKE ALL ON public.public_zltac_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_zltac_events TO anon, authenticated, service_role;

-- Owners need pending/rejected team presentation and the opaque team id used
-- by authenticated server mutations. Ownership UUIDs and invitation internals
-- never leave this actor-filtered view.
CREATE OR REPLACE VIEW public.own_zltac_teams
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  team.id,
  team.event_id,
  team.name,
  team.status,
  team.rejection_reason,
  team.state,
  team.home_venue,
  team.colour,
  team.logo_url,
  team.created_at,
  CASE
    WHEN team.captain_id = (SELECT auth.uid()) THEN 'captain'::text
    WHEN team.manager_id = (SELECT auth.uid()) THEN 'manager'::text
    ELSE NULL::text
  END AS viewer_role
FROM public.teams AS team
WHERE team.event_id IS NOT NULL
  AND (
    team.captain_id = (SELECT auth.uid())
    OR team.manager_id = (SELECT auth.uid())
  );

REVOKE ALL ON public.own_zltac_teams FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.own_zltac_teams TO authenticated, service_role;

-- A table-level SELECT grants every current and future column. Remove both
-- table and historical column grants before installing exact allow-lists.
REVOKE SELECT ON TABLE public.zltac_events FROM authenticated;
REVOKE SELECT ON TABLE public.teams FROM authenticated;
REVOKE SELECT ON TABLE public.legal_documents FROM authenticated;
REVOKE SELECT ON TABLE public.zltac_registrations FROM authenticated;

DO $$
DECLARE
  v_table text;
  v_columns text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'zltac_events',
    'teams',
    'legal_documents',
    'zltac_registrations'
  ]::text[] LOOP
    SELECT string_agg(quote_ident(attribute.attname), ', ' ORDER BY attribute.attnum)
      INTO v_columns
      FROM pg_attribute AS attribute
     WHERE attribute.attrelid = format('public.%I', v_table)::regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped;

    IF v_columns IS NOT NULL THEN
      EXECUTE format(
        'REVOKE SELECT (%s) ON TABLE public.%I FROM authenticated',
        v_columns,
        v_table
      );
    END IF;
  END LOOP;
END;
$$;

-- Own-row RLS remains the primary row boundary. This allow-list excludes every
-- committee note, override value/actor/reason/timestamp, and update audit field.
GRANT SELECT (
  id,
  user_id,
  team_id,
  year,
  side_events,
  dinner_guests,
  emergency_contact_name,
  emergency_contact_phone,
  status,
  has_confirmed_side_events,
  has_confirmed_extras,
  created_at,
  payment_reference,
  amount_owing,
  dob_at_registration
) ON TABLE public.zltac_registrations TO authenticated;

-- Players may resolve safe metadata for the active publication or a version
-- they accepted. Raw storage paths, uploader identity, notes, and audit fields
-- remain server-only; public file delivery uses /api/public branded URLs.
GRANT SELECT (
  id,
  document_type,
  version,
  original_filename,
  effective_date,
  is_active,
  requires_reacceptance,
  content_sha256,
  object_size,
  published_at
) ON TABLE public.legal_documents TO authenticated;

-- Committee cross-user registration reads are server-authoritative. The
-- service role bypasses RLS; browser sessions retain only the own-row policy.
DROP POLICY IF EXISTS "zltac_registrations_committee_read"
  ON public.zltac_registrations;

COMMENT ON VIEW public.own_zltac_teams IS
  'Authenticated actor-scoped ZLTAC team presentation without ownership profile identifiers.';
COMMENT ON VIEW public.public_zltac_events IS
  'Public event discovery and pricing without bank instructions or payment override internals.';

COMMIT;
