-- Enforce profile governance and evidence retention in PostgreSQL, not only
-- in the admin API. This migration deliberately fails closed: a portal
-- account is never hard-deleted, a referenced placeholder is never deleted,
-- profile roles are canonical, and the active-superadmin invariant survives
-- concurrent writes.

CREATE OR REPLACE FUNCTION public.profile_roles_are_canonical(p_roles text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT p_roles IS NOT NULL
     AND cardinality(p_roles) > 0
     AND 'player' = ANY (p_roles)
     AND p_roles = ARRAY(
       SELECT canonical.role
         FROM unnest(ARRAY[
           'superadmin',
           'alsa_committee',
           'zltac_committee',
           'advisor',
           'captain',
           'player'
         ]::text[]) WITH ORDINALITY AS canonical(role, ordinal)
        WHERE canonical.role = ANY (p_roles)
        ORDER BY canonical.ordinal
     );
$$;

REVOKE ALL ON FUNCTION public.profile_roles_are_canonical(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_roles_are_canonical(text[]) FROM anon;
REVOKE ALL ON FUNCTION public.profile_roles_are_canonical(text[]) FROM authenticated;
REVOKE ALL ON FUNCTION public.profile_roles_are_canonical(text[]) FROM service_role;
-- PostgreSQL evaluates CHECK predicates with the DML caller's function ACL.
-- These roles can insert/update profiles, so they need this pure immutable
-- predicate even though they cannot alter the function or governance columns.
GRANT EXECUTE ON FUNCTION public.profile_roles_are_canonical(text[])
  TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
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
  ) THEN
    RAISE EXCEPTION
      'Existing profile roles contain an unknown value; repair them before applying 61000.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.profiles AS profile
     WHERE profile.suspended
       AND 'superadmin' = ANY (profile.roles)
  ) THEN
    RAISE EXCEPTION
      'A suspended profile still has superadmin; remove that role before applying 61000.';
  END IF;
END;
$$;

-- Reorder every known legacy array, remove duplicates, and add the base player
-- role where older admin records omitted it. Unknown values fail above rather
-- than being silently discarded.
UPDATE public.profiles AS profile
   SET roles = ARRAY(
     SELECT canonical.role
       FROM unnest(ARRAY[
         'superadmin',
         'alsa_committee',
         'zltac_committee',
         'advisor',
         'captain',
         'player'
       ]::text[]) WITH ORDINALITY AS canonical(role, ordinal)
      WHERE canonical.role = ANY (profile.roles)
         OR canonical.role = 'player'
      ORDER BY canonical.ordinal
   )
 WHERE NOT public.profile_roles_are_canonical(profile.roles);

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_roles_canonical_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_roles_canonical_check
  CHECK (public.profile_roles_are_canonical(roles));

-- Removing access is an irreversible governance action. Keep the tombstone on
-- the retained profile so a later role, suspension, reset, or ordinary profile
-- write cannot accidentally recreate access or identity data.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_revoked_by uuid
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD CONSTRAINT profiles_access_revocation_pair_check
    CHECK ((access_revoked_at IS NULL) = (access_revoked_by IS NULL)),
  ADD CONSTRAINT profiles_access_revocation_state_check
    CHECK (
      access_revoked_at IS NULL
      OR (
        suspended
        AND roles = ARRAY['player']::text[]
        AND first_name IS NULL
        AND last_name IS NULL
        AND alias IS NULL
        AND dob IS NULL
        AND state IS NULL
        AND home_arena IS NULL
        AND phone IS NULL
        AND emergency_contact_name IS NULL
        AND emergency_contact_phone IS NULL
        AND alsa_member_id IS NULL
        AND avatar_url IS NULL
        AND placeholder_email IS NULL
        AND email IS NULL
        AND alsa_position IS NULL
      )
    );

-- The server API may still update ordinary profile fields directly, but all
-- role, suspension, and ALSA-position transitions must use the audited RPC.
-- Removing the table-level grant is essential because a column REVOKE cannot
-- override an existing table-level UPDATE grant.
REVOKE INSERT, UPDATE, TRUNCATE, TRIGGER, REFERENCES
  ON TABLE public.profiles FROM service_role;
GRANT UPDATE (
  first_name,
  last_name,
  alias,
  dob,
  phone,
  state,
  home_arena,
  emergency_contact_name,
  emergency_contact_phone,
  alsa_member_id,
  avatar_url,
  placeholder_email,
  email,
  updated_at
) ON TABLE public.profiles TO service_role;

-- A single counter row turns concurrent demotions into one atomic UPDATE.
-- Zero is allowed only for a newly provisioned database that has never had a
-- superadmin. Once the first active superadmin exists, the counter can never
-- transition back to zero.
CREATE TABLE public.profile_governance_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  active_superadmin_count integer NOT NULL CHECK (active_superadmin_count >= 0),
  has_had_superadmin boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_governance_active_superadmin_check
    CHECK (NOT has_had_superadmin OR active_superadmin_count >= 1)
);

INSERT INTO public.profile_governance_state (
  singleton,
  active_superadmin_count,
  has_had_superadmin
)
SELECT
  true,
  count(*)::integer,
  count(*) > 0
FROM public.profiles AS profile
WHERE NOT profile.suspended
  AND 'superadmin' = ANY (profile.roles);

ALTER TABLE public.profile_governance_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profile_governance_state FROM PUBLIC;
REVOKE ALL ON TABLE public.profile_governance_state FROM anon;
REVOKE ALL ON TABLE public.profile_governance_state FROM authenticated;
REVOKE ALL ON TABLE public.profile_governance_state FROM service_role;

CREATE TABLE public.profile_access_audit (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action text NOT NULL,
  old_roles text[] NOT NULL,
  new_roles text[] NOT NULL,
  old_suspended boolean NOT NULL,
  new_suspended boolean NOT NULL,
  old_alsa_position text,
  new_alsa_position text,
  old_access_revoked_at timestamptz,
  new_access_revoked_at timestamptz,
  old_access_revoked_by uuid,
  new_access_revoked_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profile_access_audit_profile_changed_idx
  ON public.profile_access_audit (profile_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_profile_access_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'Profile access audit rows are immutable.';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_profile_access_audit_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_profile_access_audit_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_profile_access_audit_mutation() FROM authenticated;
REVOKE ALL ON FUNCTION public.prevent_profile_access_audit_mutation() FROM service_role;

CREATE TRIGGER profile_access_audit_immutable
  BEFORE UPDATE OR DELETE ON public.profile_access_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_access_audit_mutation();

ALTER TABLE public.profile_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profile_access_audit FROM PUBLIC;
REVOKE ALL ON TABLE public.profile_access_audit FROM anon;
REVOKE ALL ON TABLE public.profile_access_audit FROM authenticated;
REVOKE ALL ON TABLE public.profile_access_audit FROM service_role;
GRANT SELECT ON TABLE public.profile_access_audit TO service_role;
REVOKE ALL ON SEQUENCE public.profile_access_audit_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.profile_access_audit_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.profile_access_audit_id_seq FROM authenticated;
REVOKE ALL ON SEQUENCE public.profile_access_audit_id_seq FROM service_role;

CREATE OR REPLACE FUNCTION public.guard_profile_access_revocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_setting text := nullif(current_setting('alsa.governance_actor_id', true), '');
  v_action text := nullif(current_setting('alsa.governance_action', true), '');
  v_actor_id uuid;
BEGIN
  IF v_actor_setting ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    v_actor_id := v_actor_setting::uuid;
  END IF;

  IF OLD.access_revoked_at IS NOT NULL THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Account access has been permanently revoked.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.access_revoked_at IS DISTINCT FROM OLD.access_revoked_at
     OR NEW.access_revoked_by IS DISTINCT FROM OLD.access_revoked_by THEN
    IF NEW.access_revoked_at IS NULL
       OR NEW.access_revoked_by IS NULL
       OR v_action NOT IN ('remove-access', 'auth-user-delete')
       OR v_actor_id IS NULL
       OR v_actor_id IS DISTINCT FROM NEW.access_revoked_by THEN
      RAISE EXCEPTION 'Account access revocation must use an attributed governance operation.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_profile_access_revocation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_profile_access_revocation() FROM anon;
REVOKE ALL ON FUNCTION public.guard_profile_access_revocation() FROM authenticated;
REVOKE ALL ON FUNCTION public.guard_profile_access_revocation() FROM service_role;

DROP TRIGGER IF EXISTS zz_profile_access_revocation_guard ON public.profiles;
CREATE TRIGGER zz_profile_access_revocation_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_access_revocation();

CREATE OR REPLACE FUNCTION public.guard_profile_governance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Serialize every governance transition before reading or updating the
  -- singleton counter. The lock is transaction-scoped and re-entrant, so the
  -- service RPC may acquire it before this trigger without deadlocking itself.
  PERFORM pg_advisory_xact_lock(61000, 1);

  IF TG_OP <> 'DELETE' THEN
    IF NEW.roles IS NULL
       OR cardinality(NEW.roles) = 0
       OR NOT ('player' = ANY (NEW.roles)) THEN
      RAISE EXCEPTION 'Profile roles must include the base player role.';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM unnest(NEW.roles) AS supplied(role)
       WHERE supplied.role <> ALL (ARRAY[
         'superadmin',
         'alsa_committee',
         'zltac_committee',
         'advisor',
         'captain',
         'player'
       ]::text[])
    ) THEN
      RAISE EXCEPTION 'Profile roles contain an unknown role.';
    END IF;

    IF cardinality(NEW.roles) <> (
      SELECT count(DISTINCT supplied.role)
        FROM unnest(NEW.roles) AS supplied(role)
    ) THEN
      RAISE EXCEPTION 'Profile roles must not contain duplicates.';
    END IF;

    NEW.roles := ARRAY(
      SELECT canonical.role
        FROM unnest(ARRAY[
          'superadmin',
          'alsa_committee',
          'zltac_committee',
          'advisor',
          'captain',
          'player'
        ]::text[]) WITH ORDINALITY AS canonical(role, ordinal)
       WHERE canonical.role = ANY (NEW.roles)
       ORDER BY canonical.ordinal
    );

    IF NEW.suspended AND 'superadmin' = ANY (NEW.roles) THEN
      RAISE EXCEPTION
        'Remove the superadmin role before suspending this account.';
    END IF;

  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_profile_governance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_profile_governance() FROM anon;
REVOKE ALL ON FUNCTION public.guard_profile_governance() FROM authenticated;
REVOKE ALL ON FUNCTION public.guard_profile_governance() FROM service_role;

DROP TRIGGER IF EXISTS profile_governance_guard ON public.profiles;
CREATE TRIGGER profile_governance_guard
  BEFORE INSERT OR DELETE OR UPDATE OF roles, suspended
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_governance();

-- Maintain the counter only after a row has actually been written. A BEFORE
-- trigger also runs for an INSERT later discarded by ON CONFLICT DO NOTHING;
-- updating the counter there would make an idempotent retry drift the state.
CREATE OR REPLACE FUNCTION public.update_profile_governance_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_active integer := 0;
  v_new_active integer := 0;
  v_delta integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(61000, 1);

  IF TG_OP <> 'DELETE' THEN
    v_new_active := CASE
      WHEN NOT NEW.suspended AND 'superadmin' = ANY (NEW.roles) THEN 1
      ELSE 0
    END;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    v_old_active := CASE
      WHEN NOT OLD.suspended AND 'superadmin' = ANY (OLD.roles) THEN 1
      ELSE 0
    END;
  END IF;

  v_delta := v_new_active - v_old_active;

  IF v_delta > 0 THEN
    UPDATE public.profile_governance_state
       SET active_superadmin_count = active_superadmin_count + v_delta,
           has_had_superadmin = true,
           updated_at = now()
     WHERE singleton;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Profile governance state is missing.';
    END IF;
  ELSIF v_delta < 0 THEN
    BEGIN
      UPDATE public.profile_governance_state
         SET active_superadmin_count = active_superadmin_count + v_delta,
             updated_at = now()
       WHERE singleton;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Profile governance state is missing.';
      END IF;
    EXCEPTION
      WHEN check_violation THEN
        RAISE EXCEPTION 'At least one active superadmin must remain.';
    END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.update_profile_governance_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_profile_governance_state() FROM anon;
REVOKE ALL ON FUNCTION public.update_profile_governance_state() FROM authenticated;
REVOKE ALL ON FUNCTION public.update_profile_governance_state() FROM service_role;

DROP TRIGGER IF EXISTS profile_governance_state_sync ON public.profiles;
CREATE TRIGGER profile_governance_state_sync
  AFTER INSERT OR DELETE OR UPDATE OF roles, suspended
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_profile_governance_state();

CREATE OR REPLACE FUNCTION public.audit_profile_access_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_setting text := nullif(current_setting('alsa.governance_actor_id', true), '');
  v_action text := coalesce(
    nullif(current_setting('alsa.governance_action', true), ''),
    'direct-governance-update'
  );
  v_actor_id uuid;
BEGIN
  IF v_actor_setting ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    v_actor_id := v_actor_setting::uuid;
  END IF;

  INSERT INTO public.profile_access_audit (
    profile_id,
    actor_id,
    action,
    old_roles,
    new_roles,
    old_suspended,
    new_suspended,
    old_alsa_position,
    new_alsa_position,
    old_access_revoked_at,
    new_access_revoked_at,
    old_access_revoked_by,
    new_access_revoked_by
  ) VALUES (
    NEW.id,
    v_actor_id,
    left(v_action, 80),
    OLD.roles,
    NEW.roles,
    OLD.suspended,
    NEW.suspended,
    OLD.alsa_position,
    NEW.alsa_position,
    OLD.access_revoked_at,
    NEW.access_revoked_at,
    OLD.access_revoked_by,
    NEW.access_revoked_by
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_profile_access_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_profile_access_change() FROM anon;
REVOKE ALL ON FUNCTION public.audit_profile_access_change() FROM authenticated;
REVOKE ALL ON FUNCTION public.audit_profile_access_change() FROM service_role;

DROP TRIGGER IF EXISTS profile_access_audit_trigger ON public.profiles;
CREATE TRIGGER profile_access_audit_trigger
  AFTER UPDATE OF roles, suspended, alsa_position, access_revoked_at, access_revoked_by
  ON public.profiles
  FOR EACH ROW
  WHEN (
    OLD.roles IS DISTINCT FROM NEW.roles
    OR OLD.suspended IS DISTINCT FROM NEW.suspended
    OR OLD.alsa_position IS DISTINCT FROM NEW.alsa_position
    OR OLD.access_revoked_at IS DISTINCT FROM NEW.access_revoked_at
    OR OLD.access_revoked_by IS DISTINCT FROM NEW.access_revoked_by
  )
  EXECUTE FUNCTION public.audit_profile_access_change();

CREATE OR REPLACE FUNCTION public.admin_mutate_profile_access(
  p_actor_id uuid,
  p_target_id uuid,
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_roles text[];
  v_position text;
  v_suspended boolean;
BEGIN
  IF p_actor_id IS NULL OR p_target_id IS NULL OR p_action IS NULL THEN
    RAISE EXCEPTION 'Actor, target, and action are required.';
  END IF;
  IF p_actor_id = p_target_id THEN
    RAISE EXCEPTION 'Cannot mutate your own account through this operation.';
  END IF;

  PERFORM pg_advisory_xact_lock(61000, 1);

  SELECT profile.*
    INTO v_actor
    FROM public.profiles AS profile
   WHERE profile.id = p_actor_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_actor.suspended
     OR NOT (v_actor.roles && ARRAY[
       'superadmin', 'alsa_committee', 'zltac_committee', 'advisor'
     ]::text[]) THEN
    RAISE EXCEPTION 'Forbidden.';
  END IF;

  SELECT profile.*
    INTO v_target
    FROM public.profiles AS profile
   WHERE profile.id = p_target_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target profile not found.';
  END IF;
  IF v_target.access_revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Account access has been permanently revoked.';
  END IF;

  PERFORM set_config('alsa.governance_actor_id', p_actor_id::text, true);
  PERFORM set_config('alsa.governance_action', left(p_action, 80), true);

  CASE p_action
    WHEN 'roles' THEN
      IF NOT ('superadmin' = ANY (v_actor.roles)) THEN
        RAISE EXCEPTION 'Only a superadmin can change roles.';
      END IF;
      IF jsonb_typeof(p_payload -> 'roles') <> 'array'
         OR EXISTS (
           SELECT 1
             FROM jsonb_array_elements(p_payload -> 'roles') AS item(value)
            WHERE jsonb_typeof(item.value) <> 'string'
         ) THEN
        RAISE EXCEPTION 'roles must be an array of strings.';
      END IF;
      SELECT array_agg(item.value #>> '{}')
        INTO v_roles
        FROM jsonb_array_elements(p_payload -> 'roles') AS item(value);
      v_position := CASE
        WHEN p_payload ? 'alsa_position'
          THEN nullif(btrim(p_payload ->> 'alsa_position'), '')
        ELSE v_target.alsa_position
      END;

      UPDATE public.profiles
         SET roles = v_roles,
             alsa_position = v_position
       WHERE id = p_target_id
       RETURNING * INTO v_target;

    WHEN 'suspension' THEN
      IF jsonb_typeof(p_payload -> 'suspended') <> 'boolean' THEN
        RAISE EXCEPTION 'suspended must be a boolean.';
      END IF;
      v_suspended := (p_payload ->> 'suspended')::boolean;
      UPDATE public.profiles
         SET suspended = v_suspended
       WHERE id = p_target_id
       RETURNING * INTO v_target;

    WHEN 'reset' THEN
      IF NOT ('superadmin' = ANY (v_actor.roles)) THEN
        RAISE EXCEPTION 'Only a superadmin can reset an account.';
      END IF;
      UPDATE public.profiles
         SET first_name = NULL,
             last_name = NULL,
             alias = NULL,
             dob = NULL,
             state = NULL,
             home_arena = NULL,
             phone = NULL,
             emergency_contact_name = NULL,
             emergency_contact_phone = NULL,
             alsa_member_id = NULL,
             avatar_url = NULL,
             placeholder_email = NULL,
             roles = ARRAY['player']::text[],
             alsa_position = NULL
       WHERE id = p_target_id
       RETURNING * INTO v_target;

    WHEN 'remove-access' THEN
      IF NOT ('superadmin' = ANY (v_actor.roles)) THEN
        RAISE EXCEPTION 'Only a superadmin can remove account access.';
      END IF;
      UPDATE public.profiles
         SET first_name = NULL,
             last_name = NULL,
             alias = NULL,
             dob = NULL,
             state = NULL,
             home_arena = NULL,
             phone = NULL,
             emergency_contact_name = NULL,
             emergency_contact_phone = NULL,
             alsa_member_id = NULL,
             avatar_url = NULL,
             placeholder_email = NULL,
             email = NULL,
             roles = ARRAY['player']::text[],
             alsa_position = NULL,
             suspended = true,
             access_revoked_at = clock_timestamp(),
             access_revoked_by = p_actor_id
       WHERE id = p_target_id
       RETURNING * INTO v_target;

    ELSE
      RAISE EXCEPTION 'Unsupported profile access action.';
  END CASE;

  RETURN jsonb_build_object(
    'id', v_target.id,
    'roles', v_target.roles,
    'suspended', v_target.suspended,
    'alsa_position', v_target.alsa_position
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_mutate_profile_access(uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_mutate_profile_access(uuid, uuid, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.admin_mutate_profile_access(uuid, uuid, text, jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.admin_mutate_profile_access(uuid, uuid, text, jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_mutate_profile_access(uuid, uuid, text, jsonb) TO service_role;

-- Direct deletes are allowed only for placeholders with no referencing row in
-- any public table. The catalog-driven check automatically covers future FKs.
CREATE OR REPLACE FUNCTION public.prevent_profile_evidence_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_reference record;
  v_has_reference boolean;
BEGIN
  IF NOT OLD.is_placeholder THEN
    RAISE EXCEPTION
      'Portal accounts cannot be hard-deleted; remove access and anonymise instead.';
  END IF;

  FOR v_reference IN
    SELECT
      referencing_namespace.nspname AS schema_name,
      referencing_table.relname AS table_name,
      referencing_column.attname AS column_name
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS referencing_table
      ON referencing_table.oid = constraint_row.conrelid
    JOIN pg_namespace AS referencing_namespace
      ON referencing_namespace.oid = referencing_table.relnamespace
    JOIN pg_attribute AS referencing_column
      ON referencing_column.attrelid = constraint_row.conrelid
     AND referencing_column.attnum = constraint_row.conkey[1]
   WHERE constraint_row.contype = 'f'
     AND constraint_row.confrelid = 'public.profiles'::regclass
     AND cardinality(constraint_row.conkey) = 1
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I = $1)',
      v_reference.schema_name,
      v_reference.table_name,
      v_reference.column_name
    )
    INTO v_has_reference
    USING OLD.id;

    IF v_has_reference THEN
      RAISE EXCEPTION
        'This placeholder has retained history and cannot be hard-deleted.';
    END IF;
  END LOOP;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_profile_evidence_deletion() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_profile_evidence_deletion() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_profile_evidence_deletion() FROM authenticated;
REVOKE ALL ON FUNCTION public.prevent_profile_evidence_deletion() FROM service_role;

DROP TRIGGER IF EXISTS profile_evidence_delete_guard ON public.profiles;
CREATE TRIGGER profile_evidence_delete_guard
  BEFORE DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_evidence_deletion();

-- An Auth deletion no longer cascades the profile and its evidence away. It
-- removes access, strips personal fields, and leaves the stable profile key in
-- place. The governance trigger still refuses deletion of the final active
-- superadmin.
CREATE OR REPLACE FUNCTION public.cleanup_profile_on_auth_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('alsa.governance_actor_id', OLD.id::text, true);
  PERFORM set_config('alsa.governance_action', 'auth-user-delete', true);

  UPDATE public.profiles
     SET first_name = NULL,
         last_name = NULL,
         alias = NULL,
         dob = NULL,
         state = NULL,
         home_arena = NULL,
         phone = NULL,
         emergency_contact_name = NULL,
         emergency_contact_phone = NULL,
         alsa_member_id = NULL,
         avatar_url = NULL,
         placeholder_email = NULL,
         email = NULL,
         roles = ARRAY['player']::text[],
         alsa_position = NULL,
         suspended = true,
         access_revoked_at = clock_timestamp(),
         access_revoked_by = OLD.id
   WHERE id = OLD.id
     AND NOT is_placeholder
     AND access_revoked_at IS NULL;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_profile_on_auth_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_profile_on_auth_delete() FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_profile_on_auth_delete() FROM authenticated;
REVOKE ALL ON FUNCTION public.cleanup_profile_on_auth_delete() FROM service_role;

COMMENT ON TABLE public.profile_access_audit IS
  'Append-only evidence for role, suspension, ALSA-position, and permanent access-revocation changes.';
COMMENT ON FUNCTION public.admin_mutate_profile_access(uuid, uuid, text, jsonb) IS
  'Service-only profile governance mutation with database authorisation, concurrency guards, and audit attribution.';
