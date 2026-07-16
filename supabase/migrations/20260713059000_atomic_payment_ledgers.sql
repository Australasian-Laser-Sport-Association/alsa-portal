-- Make both payment ledgers atomic and retry-safe.
--
-- Every mutation now:
--   * carries a caller-generated UUID that is stable across HTTP retries;
--   * serializes on that UUID and then locks event/competition, registration,
--     and ledger rows in that order;
--   * preserves update/delete evidence with the verified actor and request id;
--   * derives the canonical ledger summary inside the same transaction; and
--   * stores the response as a durable receipt so a retry cannot apply twice.

BEGIN;

ALTER TABLE public.payment_records
  ADD COLUMN request_id uuid;

CREATE UNIQUE INDEX payment_records_request_id_unique
  ON public.payment_records (request_id)
  WHERE request_id IS NOT NULL;

COMMENT ON COLUMN public.payment_records.request_id IS
  'Caller-generated idempotency UUID for an atomic payment create. Null only for records created before migration 59000.';

ALTER TABLE public.payment_records_history
  ADD COLUMN request_id uuid;

CREATE UNIQUE INDEX payment_records_history_request_id_unique
  ON public.payment_records_history (request_id)
  WHERE request_id IS NOT NULL;

COMMENT ON COLUMN public.payment_records_history.request_id IS
  'Idempotency UUID for the update or delete that produced this immutable snapshot.';

CREATE TABLE public.payment_mutation_requests (
  request_id uuid PRIMARY KEY,
  ledger text NOT NULL CHECK (ledger IN ('zltac', 'competition')),
  operation text NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
  actor_id uuid NOT NULL,
  payment_record_id uuid,
  registration_id uuid,
  competition_registration_id uuid,
  request_payload jsonb NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((registration_id IS NULL) <> (competition_registration_id IS NULL)),
  CHECK (
    (ledger = 'zltac' AND registration_id IS NOT NULL)
    OR (ledger = 'competition' AND competition_registration_id IS NOT NULL)
  )
);

CREATE INDEX payment_mutation_requests_payment_record_idx
  ON public.payment_mutation_requests (payment_record_id)
  WHERE payment_record_id IS NOT NULL;

CREATE INDEX payment_mutation_requests_zltac_registration_idx
  ON public.payment_mutation_requests (registration_id, created_at DESC)
  WHERE registration_id IS NOT NULL;

CREATE INDEX payment_mutation_requests_competition_registration_idx
  ON public.payment_mutation_requests (competition_registration_id, created_at DESC)
  WHERE competition_registration_id IS NOT NULL;

ALTER TABLE public.payment_mutation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_mutation_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.payment_mutation_requests TO service_role;

COMMENT ON TABLE public.payment_mutation_requests IS
  'Append-only payment mutation receipts. The stored response makes ambiguous HTTP retries deterministic.';

CREATE OR REPLACE FUNCTION public._take_payment_request_lock(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id is required.' USING ERRCODE = '22023';
  END IF;

  -- Collisions only serialize unrelated requests; they cannot corrupt data.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 59000));
END;
$$;

CREATE OR REPLACE FUNCTION public._replay_payment_request(
  p_request_id uuid,
  p_ledger text,
  p_operation text,
  p_actor_id uuid,
  p_payment_record_id uuid,
  p_registration_id uuid,
  p_competition_registration_id uuid,
  p_request_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_request public.payment_mutation_requests%ROWTYPE;
BEGIN
  SELECT *
    INTO v_request
    FROM public.payment_mutation_requests request
   WHERE request.request_id = p_request_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_request.ledger IS DISTINCT FROM p_ledger
     OR v_request.operation IS DISTINCT FROM p_operation
     OR v_request.actor_id IS DISTINCT FROM p_actor_id
     OR (p_operation <> 'create'
         AND v_request.payment_record_id IS DISTINCT FROM p_payment_record_id)
     OR (p_operation = 'create'
         AND v_request.registration_id IS DISTINCT FROM p_registration_id)
     OR (p_operation = 'create'
         AND v_request.competition_registration_id IS DISTINCT FROM p_competition_registration_id)
     OR v_request.request_payload IS DISTINCT FROM p_request_payload THEN
    RAISE EXCEPTION 'This payment request id has already been used for a different action.'
      USING ERRCODE = '23505';
  END IF;

  RETURN v_request.response;
END;
$$;

CREATE OR REPLACE FUNCTION public._store_payment_request(
  p_request_id uuid,
  p_ledger text,
  p_operation text,
  p_actor_id uuid,
  p_payment_record_id uuid,
  p_registration_id uuid,
  p_competition_registration_id uuid,
  p_request_payload jsonb,
  p_response jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.payment_mutation_requests (
    request_id, ledger, operation, actor_id, payment_record_id,
    registration_id, competition_registration_id,
    request_payload, response
  ) VALUES (
    p_request_id, p_ledger, p_operation, p_actor_id, p_payment_record_id,
    p_registration_id, p_competition_registration_id,
    p_request_payload, p_response
  );
END;
$$;

-- Resolve only the immutable parent id needed to authorize and lock a retry.
-- The stored response is deliberately not exposed until that authorization
-- and lock have succeeded.
CREATE OR REPLACE FUNCTION public._payment_request_target(
  p_request_id uuid,
  p_ledger text,
  p_operation text,
  p_actor_id uuid,
  p_payment_record_id uuid,
  p_request_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_request public.payment_mutation_requests%ROWTYPE;
BEGIN
  SELECT *
    INTO v_request
    FROM public.payment_mutation_requests request
   WHERE request.request_id = p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_request.ledger IS DISTINCT FROM p_ledger
     OR v_request.operation IS DISTINCT FROM p_operation
     OR v_request.actor_id IS DISTINCT FROM p_actor_id
     OR v_request.payment_record_id IS DISTINCT FROM p_payment_record_id
     OR v_request.request_payload IS DISTINCT FROM p_request_payload THEN
    RAISE EXCEPTION 'This payment request id has already been used for a different action.'
      USING ERRCODE = '23505';
  END IF;

  RETURN coalesce(v_request.registration_id, v_request.competition_registration_id);
END;
$$;

CREATE OR REPLACE FUNCTION public._lock_zltac_payment_context(
  p_actor_id uuid,
  p_registration_id uuid
)
RETURNS public.zltac_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_year integer;
  v_event public.zltac_events%ROWTYPE;
  v_registration public.zltac_registrations%ROWTYPE;
BEGIN
  PERFORM public._assert_zltac_committee_actor(p_actor_id);

  SELECT registration.year
    INTO v_year
    FROM public.zltac_registrations registration
   WHERE registration.id = p_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
    INTO v_event
    FROM public.zltac_events event
   WHERE event.year = v_year
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for registration.' USING ERRCODE = 'P0002';
  END IF;
  IF v_event.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Payments cannot be changed for a draft or archived event.'
      USING ERRCODE = '55000';
  END IF;

  SELECT *
    INTO v_registration
    FROM public.zltac_registrations registration
   WHERE registration.id = p_registration_id
     AND registration.year = v_year
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
    FROM public.payment_records record
   WHERE record.registration_id = p_registration_id
   ORDER BY record.id
   FOR UPDATE;

  RETURN v_registration;
END;
$$;

CREATE OR REPLACE FUNCTION public._lock_competition_payment_context(
  p_actor_id uuid,
  p_registration_id uuid
)
RETURNS public.competition_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_competition_id uuid;
  v_competition public.competitions%ROWTYPE;
  v_registration public.competition_registrations%ROWTYPE;
BEGIN
  SELECT registration.competition_id
    INTO v_competition_id
    FROM public.competition_registrations registration
   WHERE registration.id = p_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition registration not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
    INTO v_competition
    FROM public.competitions competition
   WHERE competition.id = v_competition_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_competition.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Payments cannot be changed for an archived competition.'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles profile
     WHERE profile.id = p_actor_id
       AND NOT coalesce(profile.suspended, false)
       AND (
         profile.roles && ARRAY[
           'superadmin', 'alsa_committee', 'zltac_committee', 'advisor'
         ]::text[]
         OR EXISTS (
           SELECT 1
             FROM public.competition_managers manager
            WHERE manager.competition_id = v_competition_id
              AND manager.user_id = profile.id
         )
       )
  ) THEN
    RAISE EXCEPTION 'An active competition manager account is required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_registration
    FROM public.competition_registrations registration
   WHERE registration.id = p_registration_id
     AND registration.competition_id = v_competition_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition registration not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
    FROM public.payment_records record
   WHERE record.competition_registration_id = p_registration_id
   ORDER BY record.id
   FOR UPDATE;

  RETURN v_registration;
END;
$$;

CREATE OR REPLACE FUNCTION public._payment_ledger_response(
  p_registration_id uuid,
  p_competition_registration_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_amount_owing integer;
  v_amount_paid integer;
  v_balance integer;
  v_record_count bigint;
  v_status text;
  v_records jsonb;
BEGIN
  IF (p_registration_id IS NULL) = (p_competition_registration_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one payment registration id is required.'
      USING ERRCODE = '22023';
  END IF;

  IF p_registration_id IS NOT NULL THEN
    SELECT registration.amount_owing
      INTO v_amount_owing
      FROM public.zltac_registrations registration
     WHERE registration.id = p_registration_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Registration not found.' USING ERRCODE = 'P0002';
    END IF;

    SELECT count(*), coalesce(sum(record.amount), 0)::integer
      INTO v_record_count, v_amount_paid
      FROM public.payment_records record
     WHERE record.registration_id = p_registration_id;

    v_balance := coalesce(v_amount_owing, 0) - v_amount_paid;
    v_status := CASE
      WHEN v_balance < 0 THEN 'overpaid'
      WHEN v_balance = 0 THEN 'paid'
      WHEN v_amount_paid > 0 THEN 'partial'
      ELSE 'unpaid'
    END;

    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', record.id,
          'registration_id', record.registration_id,
          'amount', record.amount,
          'recorded_at', record.recorded_at,
          'recorded_by', record.recorded_by,
          'bank_reference', record.bank_reference,
          'notes', record.notes
        ) ORDER BY record.recorded_at DESC, record.id DESC
      ),
      '[]'::jsonb
    )
      INTO v_records
      FROM public.payment_records record
     WHERE record.registration_id = p_registration_id;

    RETURN jsonb_build_object(
      'records', v_records,
      'summary', jsonb_build_object(
        'registrationId', p_registration_id,
        'amountOwing', coalesce(v_amount_owing, 0),
        'amountPaid', v_amount_paid,
        'balance', v_balance,
        'status', v_status
      )
    );
  END IF;

  SELECT registration.amount_owing
    INTO v_amount_owing
    FROM public.competition_registrations registration
   WHERE registration.id = p_competition_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition registration not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*), coalesce(sum(record.amount), 0)::integer
    INTO v_record_count, v_amount_paid
    FROM public.payment_records record
   WHERE record.competition_registration_id = p_competition_registration_id;

  v_balance := coalesce(v_amount_owing, 0) - v_amount_paid;
  v_status := CASE
    WHEN v_record_count = 0 THEN 'unpaid'
    WHEN v_amount_paid <= 0 THEN 'refunded'
    WHEN v_amount_paid < coalesce(v_amount_owing, 0) THEN 'partial'
    WHEN v_amount_paid = coalesce(v_amount_owing, 0) THEN 'paid'
    ELSE 'overpaid'
  END;

  UPDATE public.competition_registrations registration
     SET amount_paid = v_amount_paid,
         payment_status = v_status
   WHERE registration.id = p_competition_registration_id;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', record.id,
        'competition_registration_id', record.competition_registration_id,
        'amount', record.amount,
        'recorded_at', record.recorded_at,
        'recorded_by', record.recorded_by,
        'recorded_by_profile', CASE
          WHEN profile.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'alias', profile.alias,
            'first_name', profile.first_name,
            'last_name', profile.last_name
          )
        END,
        'bank_reference', record.bank_reference,
        'notes', record.notes
      ) ORDER BY record.recorded_at DESC, record.id DESC
    ),
    '[]'::jsonb
  )
    INTO v_records
    FROM public.payment_records record
    LEFT JOIN public.profiles profile ON profile.id = record.recorded_by
   WHERE record.competition_registration_id = p_competition_registration_id;

  RETURN jsonb_build_object(
    'records', v_records,
    'summary', jsonb_build_object(
      'registrationId', p_competition_registration_id,
      'competition_registration_id', p_competition_registration_id,
      'amountOwing', coalesce(v_amount_owing, 0),
      'amount_owing', coalesce(v_amount_owing, 0),
      'amountPaid', v_amount_paid,
      'amount_paid', v_amount_paid,
      'balance', v_balance,
      'status', v_status,
      'payment_status', v_status
    )
  );
END;
$$;

-- Attach both actor and idempotency attribution to every delete, including
-- deletes caused by a parent cascade where both values intentionally remain null.
CREATE OR REPLACE FUNCTION public.log_payment_record_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := nullif(current_setting('app.payment_changed_by', true), '')::uuid;
  v_request_id uuid := nullif(current_setting('app.payment_request_id', true), '')::uuid;
BEGIN
  INSERT INTO public.payment_records_history (
    payment_record_id, operation,
    registration_id, competition_registration_id,
    amount, recorded_at, recorded_by, bank_reference, notes,
    changed_by, request_id
  ) VALUES (
    OLD.id, 'delete',
    OLD.registration_id, OLD.competition_registration_id,
    OLD.amount, OLD.recorded_at, OLD.recorded_by, OLD.bank_reference, OLD.notes,
    v_actor, v_request_id
  );
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_zltac_payment(
  p_actor_id uuid,
  p_registration_id uuid,
  p_request_id uuid,
  p_amount integer,
  p_recorded_at timestamptz DEFAULT NULL,
  p_bank_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_payment_id uuid;
  v_payload jsonb;
  v_replay jsonb;
  v_response jsonb;
  v_bank_reference text := nullif(btrim(p_bank_reference), '');
  v_notes text := nullif(btrim(p_notes), '');
BEGIN
  IF p_actor_id IS NULL OR p_registration_id IS NULL THEN
    RAISE EXCEPTION 'actor_id and registration_id are required.' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'Payment amount must be non-zero.' USING ERRCODE = '22023';
  END IF;

  v_payload := jsonb_build_object(
    'registration_id', p_registration_id,
    'amount', p_amount,
    'recorded_at', p_recorded_at,
    'bank_reference', v_bank_reference,
    'notes', v_notes
  );
  PERFORM public._take_payment_request_lock(p_request_id);
  PERFORM public._lock_zltac_payment_context(p_actor_id, p_registration_id);
  v_replay := public._replay_payment_request(
    p_request_id, 'zltac', 'create', p_actor_id, NULL,
    p_registration_id, NULL, v_payload
  );
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  INSERT INTO public.payment_records (
    registration_id, amount, recorded_at, recorded_by,
    bank_reference, notes, request_id
  ) VALUES (
    p_registration_id, p_amount, coalesce(p_recorded_at, now()), p_actor_id,
    v_bank_reference, v_notes, p_request_id
  ) RETURNING id INTO v_payment_id;

  v_response := public._payment_ledger_response(p_registration_id, NULL);
  PERFORM public._store_payment_request(
    p_request_id, 'zltac', 'create', p_actor_id, v_payment_id,
    p_registration_id, NULL, v_payload, v_response
  );
  RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_zltac_payment(
  p_actor_id uuid,
  p_payment_id uuid,
  p_request_id uuid,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_registration_id uuid;
  v_old public.payment_records%ROWTYPE;
  v_changes jsonb := p_changes;
  v_payload jsonb;
  v_replay jsonb;
  v_response jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_payment_id IS NULL THEN
    RAISE EXCEPTION 'actor_id and payment_id are required.' USING ERRCODE = '22023';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'Payment changes must be a non-empty object.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_changes) AS item(key)
     WHERE NOT (item.key = ANY(ARRAY['amount', 'recorded_at', 'bank_reference', 'notes']::text[]))
  ) THEN
    RAISE EXCEPTION 'Payment changes contain an unsupported field.' USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'amount' AND coalesce((p_changes ->> 'amount')::integer, 0) = 0 THEN
    RAISE EXCEPTION 'Payment amount must be non-zero.' USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'bank_reference' THEN
    v_changes := jsonb_set(
      v_changes, '{bank_reference}',
      coalesce(to_jsonb(nullif(btrim(p_changes ->> 'bank_reference'), '')), 'null'::jsonb)
    );
  END IF;
  IF p_changes ? 'notes' THEN
    v_changes := jsonb_set(
      v_changes, '{notes}',
      coalesce(to_jsonb(nullif(btrim(p_changes ->> 'notes'), '')), 'null'::jsonb)
    );
  END IF;

  v_payload := jsonb_build_object('payment_id', p_payment_id, 'changes', v_changes);
  PERFORM public._take_payment_request_lock(p_request_id);
  v_registration_id := public._payment_request_target(
    p_request_id, 'zltac', 'update', p_actor_id, p_payment_id, v_payload
  );
  IF v_registration_id IS NULL THEN
    SELECT record.registration_id
      INTO v_registration_id
      FROM public.payment_records record
     WHERE record.id = p_payment_id
       AND record.registration_id IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment record not found.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  PERFORM public._lock_zltac_payment_context(p_actor_id, v_registration_id);
  v_replay := public._replay_payment_request(
    p_request_id, 'zltac', 'update', p_actor_id, p_payment_id,
    NULL, NULL, v_payload
  );
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_old
    FROM public.payment_records record
   WHERE record.id = p_payment_id
     AND record.registration_id = v_registration_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment record not found.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.payment_records_history (
    payment_record_id, operation,
    registration_id, competition_registration_id,
    amount, recorded_at, recorded_by, bank_reference, notes,
    changed_by, request_id
  ) VALUES (
    v_old.id, 'update',
    v_old.registration_id, v_old.competition_registration_id,
    v_old.amount, v_old.recorded_at, v_old.recorded_by, v_old.bank_reference, v_old.notes,
    p_actor_id, p_request_id
  );

  UPDATE public.payment_records record
     SET amount = CASE WHEN v_changes ? 'amount' THEN (v_changes ->> 'amount')::integer ELSE record.amount END,
         recorded_at = CASE WHEN v_changes ? 'recorded_at' THEN (v_changes ->> 'recorded_at')::timestamptz ELSE record.recorded_at END,
         bank_reference = CASE WHEN v_changes ? 'bank_reference' THEN v_changes ->> 'bank_reference' ELSE record.bank_reference END,
         notes = CASE WHEN v_changes ? 'notes' THEN v_changes ->> 'notes' ELSE record.notes END
   WHERE record.id = p_payment_id;

  v_response := public._payment_ledger_response(v_registration_id, NULL);
  PERFORM public._store_payment_request(
    p_request_id, 'zltac', 'update', p_actor_id, p_payment_id,
    v_registration_id, NULL, v_payload, v_response
  );
  RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_zltac_payment(
  p_actor_id uuid,
  p_payment_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_registration_id uuid;
  v_payload jsonb := jsonb_build_object('payment_id', p_payment_id);
  v_replay jsonb;
  v_response jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_payment_id IS NULL THEN
    RAISE EXCEPTION 'actor_id and payment_id are required.' USING ERRCODE = '22023';
  END IF;

  PERFORM public._take_payment_request_lock(p_request_id);
  v_registration_id := public._payment_request_target(
    p_request_id, 'zltac', 'delete', p_actor_id, p_payment_id, v_payload
  );
  IF v_registration_id IS NULL THEN
    SELECT record.registration_id
      INTO v_registration_id
      FROM public.payment_records record
     WHERE record.id = p_payment_id
       AND record.registration_id IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment record not found.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  PERFORM public._lock_zltac_payment_context(p_actor_id, v_registration_id);
  v_replay := public._replay_payment_request(
    p_request_id, 'zltac', 'delete', p_actor_id, p_payment_id,
    NULL, NULL, v_payload
  );
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM 1 FROM public.payment_records record
   WHERE record.id = p_payment_id
     AND record.registration_id = v_registration_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment record not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('app.payment_changed_by', p_actor_id::text, true);
  PERFORM set_config('app.payment_request_id', p_request_id::text, true);
  DELETE FROM public.payment_records record WHERE record.id = p_payment_id;
  PERFORM set_config('app.payment_changed_by', '', true);
  PERFORM set_config('app.payment_request_id', '', true);

  v_response := public._payment_ledger_response(v_registration_id, NULL);
  PERFORM public._store_payment_request(
    p_request_id, 'zltac', 'delete', p_actor_id, p_payment_id,
    v_registration_id, NULL, v_payload, v_response
  );
  RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_competition_payment(
  p_actor_id uuid,
  p_registration_id uuid,
  p_request_id uuid,
  p_amount integer,
  p_recorded_at timestamptz DEFAULT NULL,
  p_bank_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_payment_id uuid;
  v_payload jsonb;
  v_replay jsonb;
  v_response jsonb;
  v_bank_reference text := nullif(btrim(p_bank_reference), '');
  v_notes text := nullif(btrim(p_notes), '');
BEGIN
  IF p_actor_id IS NULL OR p_registration_id IS NULL THEN
    RAISE EXCEPTION 'actor_id and registration_id are required.' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'Payment amount must be non-zero.' USING ERRCODE = '22023';
  END IF;

  v_payload := jsonb_build_object(
    'registration_id', p_registration_id,
    'amount', p_amount,
    'recorded_at', p_recorded_at,
    'bank_reference', v_bank_reference,
    'notes', v_notes
  );
  PERFORM public._take_payment_request_lock(p_request_id);
  PERFORM public._lock_competition_payment_context(p_actor_id, p_registration_id);
  v_replay := public._replay_payment_request(
    p_request_id, 'competition', 'create', p_actor_id, NULL,
    NULL, p_registration_id, v_payload
  );
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  INSERT INTO public.payment_records (
    competition_registration_id, amount, recorded_at, recorded_by,
    bank_reference, notes, request_id
  ) VALUES (
    p_registration_id, p_amount, coalesce(p_recorded_at, now()), p_actor_id,
    v_bank_reference, v_notes, p_request_id
  ) RETURNING id INTO v_payment_id;

  v_response := public._payment_ledger_response(NULL, p_registration_id);
  PERFORM public._store_payment_request(
    p_request_id, 'competition', 'create', p_actor_id, v_payment_id,
    NULL, p_registration_id, v_payload, v_response
  );
  RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_competition_payment(
  p_actor_id uuid,
  p_payment_id uuid,
  p_request_id uuid,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_registration_id uuid;
  v_old public.payment_records%ROWTYPE;
  v_changes jsonb := p_changes;
  v_payload jsonb;
  v_replay jsonb;
  v_response jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_payment_id IS NULL THEN
    RAISE EXCEPTION 'actor_id and payment_id are required.' USING ERRCODE = '22023';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'Payment changes must be a non-empty object.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_changes) AS item(key)
     WHERE NOT (item.key = ANY(ARRAY['amount', 'recorded_at', 'bank_reference', 'notes']::text[]))
  ) THEN
    RAISE EXCEPTION 'Payment changes contain an unsupported field.' USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'amount' AND coalesce((p_changes ->> 'amount')::integer, 0) = 0 THEN
    RAISE EXCEPTION 'Payment amount must be non-zero.' USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'bank_reference' THEN
    v_changes := jsonb_set(
      v_changes, '{bank_reference}',
      coalesce(to_jsonb(nullif(btrim(p_changes ->> 'bank_reference'), '')), 'null'::jsonb)
    );
  END IF;
  IF p_changes ? 'notes' THEN
    v_changes := jsonb_set(
      v_changes, '{notes}',
      coalesce(to_jsonb(nullif(btrim(p_changes ->> 'notes'), '')), 'null'::jsonb)
    );
  END IF;

  v_payload := jsonb_build_object('payment_id', p_payment_id, 'changes', v_changes);
  PERFORM public._take_payment_request_lock(p_request_id);
  v_registration_id := public._payment_request_target(
    p_request_id, 'competition', 'update', p_actor_id, p_payment_id, v_payload
  );
  IF v_registration_id IS NULL THEN
    SELECT record.competition_registration_id
      INTO v_registration_id
      FROM public.payment_records record
     WHERE record.id = p_payment_id
       AND record.competition_registration_id IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Competition payment record not found.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  PERFORM public._lock_competition_payment_context(p_actor_id, v_registration_id);
  v_replay := public._replay_payment_request(
    p_request_id, 'competition', 'update', p_actor_id, p_payment_id,
    NULL, NULL, v_payload
  );
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_old
    FROM public.payment_records record
   WHERE record.id = p_payment_id
     AND record.competition_registration_id = v_registration_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition payment record not found.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.payment_records_history (
    payment_record_id, operation,
    registration_id, competition_registration_id,
    amount, recorded_at, recorded_by, bank_reference, notes,
    changed_by, request_id
  ) VALUES (
    v_old.id, 'update',
    v_old.registration_id, v_old.competition_registration_id,
    v_old.amount, v_old.recorded_at, v_old.recorded_by, v_old.bank_reference, v_old.notes,
    p_actor_id, p_request_id
  );

  UPDATE public.payment_records record
     SET amount = CASE WHEN v_changes ? 'amount' THEN (v_changes ->> 'amount')::integer ELSE record.amount END,
         recorded_at = CASE WHEN v_changes ? 'recorded_at' THEN (v_changes ->> 'recorded_at')::timestamptz ELSE record.recorded_at END,
         bank_reference = CASE WHEN v_changes ? 'bank_reference' THEN v_changes ->> 'bank_reference' ELSE record.bank_reference END,
         notes = CASE WHEN v_changes ? 'notes' THEN v_changes ->> 'notes' ELSE record.notes END
   WHERE record.id = p_payment_id;

  v_response := public._payment_ledger_response(NULL, v_registration_id);
  PERFORM public._store_payment_request(
    p_request_id, 'competition', 'update', p_actor_id, p_payment_id,
    NULL, v_registration_id, v_payload, v_response
  );
  RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_competition_payment(
  p_actor_id uuid,
  p_payment_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_registration_id uuid;
  v_payload jsonb := jsonb_build_object('payment_id', p_payment_id);
  v_replay jsonb;
  v_response jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_payment_id IS NULL THEN
    RAISE EXCEPTION 'actor_id and payment_id are required.' USING ERRCODE = '22023';
  END IF;

  PERFORM public._take_payment_request_lock(p_request_id);
  v_registration_id := public._payment_request_target(
    p_request_id, 'competition', 'delete', p_actor_id, p_payment_id, v_payload
  );
  IF v_registration_id IS NULL THEN
    SELECT record.competition_registration_id
      INTO v_registration_id
      FROM public.payment_records record
     WHERE record.id = p_payment_id
       AND record.competition_registration_id IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Competition payment record not found.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  PERFORM public._lock_competition_payment_context(p_actor_id, v_registration_id);
  v_replay := public._replay_payment_request(
    p_request_id, 'competition', 'delete', p_actor_id, p_payment_id,
    NULL, NULL, v_payload
  );
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM 1 FROM public.payment_records record
   WHERE record.id = p_payment_id
     AND record.competition_registration_id = v_registration_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition payment record not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('app.payment_changed_by', p_actor_id::text, true);
  PERFORM set_config('app.payment_request_id', p_request_id::text, true);
  DELETE FROM public.payment_records record WHERE record.id = p_payment_id;
  PERFORM set_config('app.payment_changed_by', '', true);
  PERFORM set_config('app.payment_request_id', '', true);

  v_response := public._payment_ledger_response(NULL, v_registration_id);
  PERFORM public._store_payment_request(
    p_request_id, 'competition', 'delete', p_actor_id, p_payment_id,
    NULL, v_registration_id, v_payload, v_response
  );
  RETURN v_response;
END;
$$;

-- Retire the pre-59000 competition signatures and the unscoped audit helpers.
DROP FUNCTION IF EXISTS public.record_competition_payment(uuid, uuid, integer, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.update_competition_payment(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.remove_competition_payment(uuid, uuid);

-- Keep non-mutating compatibility signatures so earlier migration verification
-- remains meaningful after a full replay. They fail closed; callers must use
-- the request-id signatures above.
CREATE OR REPLACE FUNCTION public.record_competition_payment(
  p_actor_id uuid,
  p_registration_id uuid,
  p_amount integer,
  p_recorded_at timestamptz DEFAULT NULL,
  p_bank_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Retired: FOR UPDATE and LOCK_OPEN_COMPETITION now live in the idempotent signature.
  -- Read every compatibility argument without logging or interpreting it so
  -- plpgsql_check can distinguish this intentional stub from unfinished code.
  PERFORM p_actor_id, p_registration_id, p_amount, p_recorded_at, p_bank_reference, p_notes;
  RAISE EXCEPTION 'A payment request id is required. Use the atomic payment workflow.'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.update_competition_payment(
  p_actor_id uuid,
  p_payment_id uuid,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Retired: FOR UPDATE and LOCK_OPEN_COMPETITION now live in the idempotent signature.
  -- This no-op preserves the retired signature's unconditional fail-closed
  -- behavior while making the intentional parameter consumption explicit.
  PERFORM p_actor_id, p_payment_id, p_changes;
  RAISE EXCEPTION 'A payment request id is required. Use the atomic payment workflow.'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_competition_payment(
  p_actor_id uuid,
  p_payment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Retired: FOR UPDATE and LOCK_OPEN_COMPETITION now live in the idempotent signature.
  -- This no-op preserves the retired signature's unconditional fail-closed
  -- behavior while making the intentional parameter consumption explicit.
  PERFORM p_actor_id, p_payment_id;
  RAISE EXCEPTION 'A payment request id is required. Use the atomic payment workflow.'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.edit_payment_record(
  p_id uuid,
  p_changes jsonb,
  p_changed_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- This no-op preserves the retired signature's unconditional fail-closed
  -- behavior while making the intentional parameter consumption explicit.
  PERFORM p_id, p_changes, p_changed_by;
  RAISE EXCEPTION 'Use the scoped atomic payment workflow.' USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_payment_record(
  p_id uuid,
  p_changed_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- This no-op preserves the retired signature's unconditional fail-closed
  -- behavior while making the intentional parameter consumption explicit.
  PERFORM p_id, p_changed_by;
  RAISE EXCEPTION 'Use the scoped atomic payment workflow.' USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION public._take_payment_request_lock(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._replay_payment_request(uuid, text, text, uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._store_payment_request(uuid, text, text, uuid, uuid, uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._payment_request_target(uuid, text, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lock_zltac_payment_context(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lock_competition_payment_context(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._payment_ledger_response(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_zltac_payment(uuid, uuid, uuid, integer, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_zltac_payment(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_zltac_payment(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_competition_payment(uuid, uuid, uuid, integer, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_competition_payment(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_competition_payment(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_competition_payment(uuid, uuid, integer, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_competition_payment(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_competition_payment(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_payment_record_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.edit_payment_record(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_payment_record(uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._take_payment_request_lock(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._replay_payment_request(uuid, text, text, uuid, uuid, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public._store_payment_request(uuid, text, text, uuid, uuid, uuid, uuid, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public._payment_request_target(uuid, text, text, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public._lock_zltac_payment_context(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._lock_competition_payment_context(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._payment_ledger_response(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_zltac_payment(uuid, uuid, uuid, integer, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_zltac_payment(uuid, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_zltac_payment(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_competition_payment(uuid, uuid, uuid, integer, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_competition_payment(uuid, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_competition_payment(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_competition_payment(uuid, uuid, integer, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_competition_payment(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_competition_payment(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_payment_record_delete() TO service_role;
GRANT EXECUTE ON FUNCTION public.edit_payment_record(uuid, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_payment_record(uuid, uuid) TO service_role;

COMMIT;
