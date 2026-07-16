-- ALSA Portal security-remediation inventory (read-only).
--
-- Run separately against staging and production only after independently
-- confirming the linked project reference. Results contain catalog metadata
-- and aggregate counts, never member-row values. Save the output in the
-- maintainer's private release evidence.

SELECT
  current_database() AS database_name,
  current_user AS executing_role,
  current_setting('server_version') AS postgres_version,
  clock_timestamp() AS captured_at;

SELECT version, name, statements
FROM supabase_migrations.schema_migrations
ORDER BY version;

-- Table and column grants exposed to browser/database roles.
SELECT table_schema, table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema IN ('public', 'storage')
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
ORDER BY table_schema, table_name, grantee, privilege_type;

SELECT table_schema, table_name, column_name, grantee, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
ORDER BY table_name, column_name, grantee, privilege_type;

-- RLS state and policy expressions.
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'storage')
  AND c.relkind IN ('r', 'p')
ORDER BY n.nspname, c.relname;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

-- Function owner, security context, pinned settings, and execution ACL.
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_userbyid(p.proowner) AS owner,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,
  p.proconfig AS settings,
  coalesce(p.proacl, acldefault('f', p.proowner)) AS execute_acl
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname, identity_arguments;

-- Deployed columns, constraints, triggers, and public views.
SELECT table_name, ordinal_position, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

SELECT
  conrelid::regclass AS relation_name,
  conname AS constraint_name,
  contype AS constraint_type,
  convalidated AS validated,
  pg_get_constraintdef(oid, true) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
ORDER BY conrelid::regclass::text, constraint_name;

SELECT
  event_object_table AS relation_name,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY relation_name, trigger_name, event_manipulation;

SELECT schemaname, viewname, viewowner, definition
FROM pg_views
WHERE schemaname = 'public'
ORDER BY viewname;

SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets
ORDER BY id;

-- Aggregate integrity preflight. No personal values are returned. The checks
-- include every known legacy-data condition that makes a remediation migration
-- stop fail closed, so it can be resolved before entering a change window.
SELECT 'registered_profiles_missing_dob' AS check_name, count(*) AS finding_count
FROM public.profiles AS p
WHERE p.dob IS NULL
  AND (
    EXISTS (SELECT 1 FROM public.zltac_registrations AS r WHERE r.user_id = p.id)
    OR EXISTS (SELECT 1 FROM public.competition_registrations AS r WHERE r.user_id = p.id)
  )
UNION ALL
SELECT 'profiles_with_invalid_dob', count(*)
FROM public.profiles
WHERE dob IS NOT NULL AND (dob < DATE '1900-01-01' OR dob > current_date)
UNION ALL
SELECT 'profile_email_auth_mismatch', count(*)
FROM public.profiles AS p
JOIN auth.users AS u ON u.id = p.id
WHERE p.email IS DISTINCT FROM u.email
UNION ALL
SELECT 'profiles_with_blank_or_edge_space_alias', count(*)
FROM public.profiles
WHERE alias IS NOT NULL
  AND (alias IS DISTINCT FROM btrim(alias) OR btrim(alias) = '')
UNION ALL
SELECT 'duplicate_normalized_profile_aliases', count(*)
FROM (
  SELECT lower(btrim(alias))
  FROM public.profiles
  WHERE alias IS NOT NULL
  GROUP BY lower(btrim(alias))
  HAVING count(*) > 1
) AS duplicate_aliases
UNION ALL
SELECT 'u18_approved_without_approver', count(*)
FROM public.under_18_approvals
WHERE status = 'approved' AND (approved_by IS NULL OR approved_at IS NULL)
UNION ALL
SELECT 'u18_nonapproved_with_decision_metadata', count(*)
FROM public.under_18_approvals
WHERE status <> 'approved' AND (approved_by IS NOT NULL OR approved_at IS NOT NULL)
UNION ALL
SELECT 'teams_with_both_event_and_competition_scope', count(*)
FROM public.teams
WHERE event_id IS NOT NULL AND competition_id IS NOT NULL
UNION ALL
SELECT 'teams_without_event_or_competition_scope', count(*)
FROM public.teams
WHERE event_id IS NULL AND competition_id IS NULL
UNION ALL
SELECT 'duplicate_legal_document_file_paths', count(*)
FROM (
  SELECT file_path
  FROM public.legal_documents
  GROUP BY file_path
  HAVING count(*) > 1
) AS duplicate_paths
UNION ALL
SELECT 'overlapping_membership_period_pairs', count(*)
FROM public.alsa_membership_periods AS left_period
JOIN public.alsa_membership_periods AS right_period
  ON left_period.id < right_period.id
 AND left_period.starts_at < right_period.ends_at
 AND left_period.ends_at > right_period.starts_at
UNION ALL
SELECT 'excess_running_backup_runs', greatest(count(*) - 1, 0)
FROM public.backup_runs
WHERE status = 'running'
UNION ALL
SELECT 'competition_duplicate_accepted_memberships', count(*)
FROM (
  SELECT team.competition_id, member.user_id
  FROM public.team_members AS member
  JOIN public.teams AS team ON team.id = member.team_id
  WHERE team.competition_id IS NOT NULL
    AND member.invite_status = 'accepted'
  GROUP BY team.competition_id, member.user_id
  HAVING count(*) > 1
) AS duplicate_memberships
UNION ALL
SELECT 'competition_membership_registration_mismatch', count(*)
FROM public.team_members AS member
JOIN public.teams AS team ON team.id = member.team_id
WHERE team.competition_id IS NOT NULL
  AND member.invite_status = 'accepted'
  AND NOT EXISTS (
    SELECT 1
    FROM public.competition_registrations AS registration
    WHERE registration.competition_id = team.competition_id
      AND registration.user_id = member.user_id
      AND registration.team_id = member.team_id
  )
UNION ALL
SELECT 'duplicate_doubles_participant_years', count(*)
FROM (
  SELECT event_year, member_id
  FROM (
    SELECT event_year, player1_id AS member_id FROM public.doubles_pairs
    UNION ALL
    SELECT event_year, player2_id AS member_id FROM public.doubles_pairs
  ) AS members
  WHERE member_id IS NOT NULL
  GROUP BY event_year, member_id
  HAVING count(*) > 1
) AS duplicate_doubles
UNION ALL
SELECT 'duplicate_triples_participant_years', count(*)
FROM (
  SELECT event_year, member_id
  FROM (
    SELECT event_year, player1_id AS member_id FROM public.triples_teams
    UNION ALL
    SELECT event_year, player2_id AS member_id FROM public.triples_teams
    UNION ALL
    SELECT event_year, player3_id AS member_id FROM public.triples_teams
  ) AS members
  WHERE member_id IS NOT NULL
  GROUP BY event_year, member_id
  HAVING count(*) > 1
) AS duplicate_triples
UNION ALL
SELECT 'confirmed_doubles_missing_participant', count(*)
FROM public.doubles_pairs
WHERE confirmed
  AND (player1_id IS NULL OR player2_id IS NULL)
UNION ALL
SELECT 'incoherent_triples_confirmation', count(*)
FROM public.triples_teams
WHERE (player2_confirmed AND player2_id IS NULL)
   OR (player3_confirmed AND player3_id IS NULL)
   OR (
     confirmed
     AND (
       player1_id IS NULL
       OR player2_id IS NULL
       OR player3_id IS NULL
       OR NOT player2_confirmed
       OR NOT player3_confirmed
     )
   )
UNION ALL
SELECT 'legal_acceptances_orphan_event_year', count(*)
FROM public.legal_acceptances AS acceptance
LEFT JOIN public.zltac_events AS event ON event.year = acceptance.event_year
WHERE event.id IS NULL
UNION ALL
SELECT 'legal_acceptances_missing_profile', count(*)
FROM public.legal_acceptances AS acceptance
LEFT JOIN public.profiles AS profile ON profile.id = acceptance.user_id
WHERE acceptance.user_id IS NOT NULL
  AND profile.id IS NULL
UNION ALL
SELECT 'under_18_approvals_orphan_event_year', count(*)
FROM public.under_18_approvals AS approval
LEFT JOIN public.zltac_events AS event ON event.year = approval.event_year
WHERE event.id IS NULL
UNION ALL
SELECT 'under_18_approvals_missing_profile', count(*)
FROM public.under_18_approvals AS approval
LEFT JOIN public.profiles AS profile ON profile.id = approval.user_id
WHERE approval.user_id IS NOT NULL
  AND profile.id IS NULL
UNION ALL
SELECT 'profiles_with_unknown_roles', count(*)
FROM public.profiles AS profile
WHERE profile.roles IS NULL
   OR EXISTS (
     SELECT 1
     FROM unnest(profile.roles) AS supplied(role)
     WHERE supplied.role <> ALL (ARRAY[
       'superadmin',
       'alsa_committee',
       'zltac_committee',
       'advisor',
       'captain',
       'player'
     ]::text[])
   )
UNION ALL
SELECT 'suspended_profiles_with_superadmin', count(*)
FROM public.profiles
WHERE coalesce(suspended, false)
  AND 'superadmin' = ANY (coalesce(roles, ARRAY[]::text[]))
UNION ALL
SELECT 'documents_with_cross_scope_category', count(*)
FROM public.documents AS document
JOIN public.document_categories AS category ON category.id = document.category_id
WHERE document.scope IS DISTINCT FROM category.scope
UNION ALL
SELECT 'dynasties_with_invalid_category_years', count(*)
FROM public.zltac_dynasties AS dynasty
WHERE NOT (
  pg_catalog.array_ndims(dynasty.years) = 1
  AND pg_catalog.array_lower(dynasty.years, 1) = 1
  AND pg_catalog.array_position(dynasty.years, NULL) IS NULL
  AND (
    (
      dynasty.category = 'three_peat'
      AND pg_catalog.cardinality(dynasty.years) = 3
      AND dynasty.years[2] = dynasty.years[1] + 1
      AND dynasty.years[3] = dynasty.years[2] + 1
    )
    OR (
      dynasty.category = 'back_to_back'
      AND pg_catalog.cardinality(dynasty.years) = 2
      AND dynasty.years[2] = dynasty.years[1] + 1
    )
  )
)
ORDER BY check_name;
