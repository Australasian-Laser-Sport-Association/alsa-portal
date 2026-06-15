-- Run against the hosted database before applying any 20260615* migration.
-- This script is read-only and raises on the first schema assumption mismatch.

DO $$
DECLARE
  item text;
  parts text[];
  required_relations text[] := ARRAY[
    'public.legal_acceptances',
    'public.teams',
    'public.referee_questions',
    'public.profiles',
    'public.competition_managers',
    'public.zltac_events',
    'public.zltac_registrations',
    'public.team_members',
    'storage.buckets',
    'storage.objects'
  ];
  required_columns text[] := ARRAY[
    'public.legal_acceptances.user_id',
    'public.legal_acceptances.document_id',
    'public.legal_acceptances.event_year',
    'public.legal_acceptances.accepted_at',
    'storage.buckets.id',
    'storage.buckets.name',
    'storage.buckets.public',
    'storage.buckets.file_size_limit',
    'storage.buckets.allowed_mime_types',
    'storage.objects.bucket_id',
    'storage.objects.name',
    'public.teams.id',
    'public.teams.name',
    'public.teams.captain_id',
    'public.teams.manager_id',
    'public.teams.event_id',
    'public.teams.format',
    'public.teams.status',
    'public.teams.state',
    'public.teams.home_venue',
    'public.teams.colour',
    'public.teams.logo_url',
    'public.referee_questions.image_url',
    'public.profiles.id',
    'public.profiles.alias',
    'public.profiles.roles',
    'public.profiles.suspended',
    'public.competition_managers.competition_id',
    'public.competition_managers.user_id',
    'public.zltac_events.id',
    'public.zltac_events.year',
    'public.zltac_events.status',
    'public.zltac_events.reg_close_date',
    'public.zltac_events.max_teams',
    'public.zltac_events.max_players',
    'public.zltac_events.max_players_per_team',
    'public.zltac_events.main_fee',
    'public.zltac_events.team_fee',
    'public.zltac_events.side_events',
    'public.zltac_events.dinner_guest_price',
    'public.zltac_events.processing_fee_pct',
    'public.zltac_registrations.id',
    'public.zltac_registrations.user_id',
    'public.zltac_registrations.year',
    'public.zltac_registrations.team_id',
    'public.zltac_registrations.side_events',
    'public.zltac_registrations.status',
    'public.zltac_registrations.dinner_guests',
    'public.zltac_registrations.amount_owing',
    'public.team_members.team_id',
    'public.team_members.user_id',
    'public.team_members.roles',
    'public.team_members.invite_status',
    'public.team_members.responded_at'
  ];
BEGIN
  FOREACH item IN ARRAY required_relations LOOP
    IF to_regclass(item) IS NULL THEN
      RAISE EXCEPTION 'Required relation is missing: %', item;
    END IF;
  END LOOP;

  FOREACH item IN ARRAY required_columns LOOP
    parts := string_to_array(item, '.');
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = parts[1]
        AND table_name = parts[2]
        AND column_name = parts[3]
    ) THEN
      RAISE EXCEPTION 'Required column is missing: %', item;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'team-logos') THEN
    RAISE EXCEPTION 'Required storage bucket is missing: team-logos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'referee-test-media') THEN
    RAISE EXCEPTION 'Required storage bucket is missing: referee-test-media';
  END IF;

  IF to_regclass('public.profile_change_audit') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM supabase_migrations.schema_migrations
       WHERE version = '20260615030000'
     ) THEN
    RAISE EXCEPTION 'profile_change_audit already exists before its migration';
  END IF;
  IF to_regclass('public.backup_runs') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM supabase_migrations.schema_migrations
       WHERE version = '20260615050000'
     ) THEN
    RAISE EXCEPTION 'backup_runs already exists before its migration';
  END IF;

  IF to_regprocedure('public.claim_placeholder_profile(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required function is missing: claim_placeholder_profile(uuid,uuid)';
  END IF;
  IF to_regprocedure('public.protect_registration_admin_fields()') IS NULL THEN
    RAISE EXCEPTION 'Required trigger function is missing: protect_registration_admin_fields()';
  END IF;
  IF to_regprocedure('public.enforce_zltac_roster_lock()') IS NULL THEN
    RAISE EXCEPTION 'Required trigger function is missing: enforce_zltac_roster_lock()';
  END IF;
  IF to_regprocedure('public.set_zltac_registration_payment_reference()') IS NULL THEN
    RAISE EXCEPTION 'Required trigger function is missing: set_zltac_registration_payment_reference()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.zltac_registrations'::regclass
      AND conname = 'zltac_registrations_user_id_year_key'
  ) THEN
    RAISE EXCEPTION 'Required unique key is missing: zltac_registrations(user_id, year)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.team_members'::regclass
      AND conname = 'team_members_team_id_user_id_key'
  ) THEN
    RAISE EXCEPTION 'Required unique key is missing: team_members(team_id, user_id)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.zltac_registrations'::regclass
      AND tgname = 'trg_protect_registration_admin_fields'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Required trigger is missing: trg_protect_registration_admin_fields';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.zltac_registrations'::regclass
      AND tgname = 'trg_enforce_zltac_roster_lock'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Required trigger is missing: trg_enforce_zltac_roster_lock';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.zltac_registrations'::regclass
      AND tgname = 'zltac_registrations_set_payment_reference'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Required trigger is missing: zltac_registrations_set_payment_reference';
  END IF;

  RAISE NOTICE 'PASS: hosted schema satisfies all 20260615 migration preconditions';
END $$;
