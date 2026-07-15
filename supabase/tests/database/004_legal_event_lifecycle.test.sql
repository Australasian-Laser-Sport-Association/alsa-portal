BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

-- Keep the one-open-event index deterministic in disposable databases.
UPDATE public.zltac_events SET status = 'draft' WHERE status = 'open';

INSERT INTO public.profiles (id, first_name, alias, dob, roles, suspended)
VALUES
  (
    'b1000000-0000-4000-8000-000000000001',
    'Legal advisor',
    'LegalLifecycleAdvisor',
    DATE '1980-01-01',
    ARRAY['advisor', 'player']::text[],
    false
  ),
  (
    'b1000000-0000-4000-8000-000000000002',
    'Under eighteen player',
    'LegalLifecyclePlayer',
    DATE '2015-01-01',
    ARRAY['player']::text[],
    false
  );

INSERT INTO public.zltac_events (
  id, name, year, status, start_date, end_date, timezone
) VALUES
  (
    'b2000000-0000-4000-8000-000000000001',
    'Legal lifecycle open', 2030, 'open',
    DATE '2030-07-01', DATE '2030-07-03', 'Australia/Sydney'
  ),
  (
    'b2000000-0000-4000-8000-000000000002',
    'Legal lifecycle draft', 2031, 'draft',
    DATE '2031-07-01', DATE '2031-07-03', 'Australia/Sydney'
  ),
  (
    'b2000000-0000-4000-8000-000000000003',
    'Legal lifecycle archived', 2032, 'archived',
    DATE '2032-07-01', DATE '2032-07-03', 'Australia/Sydney'
  ),
  (
    'b2000000-0000-4000-8000-000000000004',
    'Legal lifecycle closed', 2033, 'closed',
    DATE '2033-07-01', DATE '2033-07-03', 'Australia/Sydney'
  );

INSERT INTO public.zltac_registrations (
  id, user_id, year, status, dob_at_registration
) VALUES
  (
    'b3000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000002', 2030, 'pending', DATE '2015-01-01'
  ),
  (
    'b3000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000002', 2031, 'pending', DATE '2015-01-01'
  ),
  (
    'b3000000-0000-4000-8000-000000000003',
    'b1000000-0000-4000-8000-000000000002', 2032, 'pending', DATE '2015-01-01'
  ),
  (
    'b3000000-0000-4000-8000-000000000004',
    'b1000000-0000-4000-8000-000000000002', 2033, 'pending', DATE '2015-01-01'
  );

CREATE TEMP TABLE legal_lifecycle_documents ON COMMIT DROP AS
SELECT
  (public.publish_legal_document(
    'code_of_conduct',
    'legal/code_of_conduct/b4000000-0000-4000-8000-000000000001.pdf',
    'Code of Conduct.pdf',
    DATE '2026-07-14',
    'b1000000-0000-4000-8000-000000000001',
    true,
    NULL,
    repeat('a', 64),
    1024
  )->>'id')::uuid AS code_of_conduct_id,
  (public.publish_legal_document(
    'under_18_form',
    'legal/under_18_form/b4000000-0000-4000-8000-000000000002.pdf',
    'Under 18 Form.pdf',
    DATE '2026-07-14',
    'b1000000-0000-4000-8000-000000000001',
    true,
    NULL,
    repeat('b', 64),
    1024
  )->>'id')::uuid AS under_18_form_id;

GRANT SELECT ON legal_lifecycle_documents TO service_role;

SELECT is(
  (
    public.reconcile_legal_document_publication(
      'code_of_conduct',
      'legal/code_of_conduct/b4000000-0000-4000-8000-000000000001.pdf',
      repeat('a', 64),
      1024
    )->>'id'
  )::uuid,
  (SELECT code_of_conduct_id FROM legal_lifecycle_documents),
  'publication reconciliation reloads the exact committed object identity'
);

SELECT is(
  public.reconcile_legal_document_publication(
    'code_of_conduct',
    'legal/code_of_conduct/b4000000-0000-4000-8000-000000000001.pdf',
    repeat('a', 64),
    1025
  ),
  NULL::jsonb,
  'publication reconciliation proves a mismatched object has no database row'
);

SET LOCAL ROLE service_role;

SELECT throws_matching(
  $$
    INSERT INTO public.legal_acceptances (
      user_id, document_id, event_year
    ) VALUES (
      'b1000000-0000-4000-8000-000000000002',
      'b4000000-0000-4000-8000-000000000001',
      2030
    )
  $$,
  'permission denied for table legal_acceptances',
  'service-role callers cannot bypass the legal acceptance RPC'
);

SELECT throws_matching(
  $$
    INSERT INTO public.under_18_approvals (user_id, event_year)
    VALUES ('b1000000-0000-4000-8000-000000000002', 2030)
  $$,
  'permission denied for table under_18_approvals',
  'service-role callers cannot bypass the under-18 RPCs'
);

SELECT lives_ok(
  format(
    $sql$
      SELECT public.accept_legal_document(
        'b1000000-0000-4000-8000-000000000002',
        2030,
        %L::uuid,
        '203.0.113.10'::inet,
        'pgtap legal lifecycle'
      )
    $sql$,
    (SELECT code_of_conduct_id FROM legal_lifecycle_documents)
  ),
  'an open-event acceptance succeeds through the locked RPC'
);

SELECT is(
  (
    SELECT acceptance.content_sha256
      FROM public.legal_acceptances AS acceptance
     WHERE acceptance.user_id = 'b1000000-0000-4000-8000-000000000002'
       AND acceptance.event_year = 2030
  ),
  repeat('a', 64),
  'the acceptance stores the locked published document digest'
);

SELECT lives_ok(
  format(
    $sql$
      SELECT public.accept_legal_document(
        'b1000000-0000-4000-8000-000000000002',
        2033,
        %L::uuid,
        NULL::inet,
        NULL
      )
    $sql$,
    (SELECT code_of_conduct_id FROM legal_lifecycle_documents)
  ),
  'a closed event can still collect outstanding legal evidence'
);

SELECT throws_ok(
  format(
    $sql$
      SELECT public.accept_legal_document(
        'b1000000-0000-4000-8000-000000000002',
        2031,
        %L::uuid,
        NULL::inet,
        NULL
      )
    $sql$,
    (SELECT code_of_conduct_id FROM legal_lifecycle_documents)
  ),
  '55000',
  'Only open or closed events can accept legal documents.',
  'draft events reject legal acceptances'
);

SELECT throws_ok(
  format(
    $sql$
      SELECT public.accept_legal_document(
        'b1000000-0000-4000-8000-000000000002',
        2032,
        %L::uuid,
        NULL::inet,
        NULL
      )
    $sql$,
    (SELECT code_of_conduct_id FROM legal_lifecycle_documents)
  ),
  '55000',
  'Only open or closed events can accept legal documents.',
  'archived events reject legal acceptances'
);

SELECT lives_ok(
  format(
    $sql$
      SELECT public.submit_under_18_approval(
        'b1000000-0000-4000-8000-000000000002',
        2030,
        %L::uuid
      )
    $sql$,
    (SELECT under_18_form_id FROM legal_lifecycle_documents)
  ),
  'an open-event under-18 submission succeeds through the locked RPC'
);

SELECT lives_ok(
  $$
    SELECT public.committee_decide_under_18_approval(
      'b1000000-0000-4000-8000-000000000001',
      (
        SELECT id FROM public.under_18_approvals
         WHERE user_id = 'b1000000-0000-4000-8000-000000000002'
           AND event_year = 2030
      ),
      'approved',
      'Form reviewed'
    )
  $$,
  'an advisor can decide an open-event approval through the locked RPC'
);

SELECT is(
  (
    SELECT status FROM public.under_18_approvals
     WHERE user_id = 'b1000000-0000-4000-8000-000000000002'
       AND event_year = 2030
  ),
  'approved'::text,
  'the committee decision records approved state'
);

SELECT lives_ok(
  $$
    SELECT public.committee_create_under_18_approval(
      'b1000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000002',
      2033,
      'approved',
      'Closed-event form reviewed'
    )
  $$,
  'committee create remains available for a closed event'
);

SELECT throws_ok(
  $$
    SELECT public.committee_create_under_18_approval(
      'b1000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000002',
      2031,
      'pending',
      NULL
    )
  $$,
  '55000',
  'Only open or closed events can accept under-18 approval changes.',
  'committee create rejects a draft event'
);

RESET ROLE;

INSERT INTO public.under_18_approvals (
  id, user_id, event_year, document_id, status, submitted_at
)
SELECT
  'b5000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000002',
  2031,
  under_18_form_id,
  'pending',
  clock_timestamp()
FROM legal_lifecycle_documents;

SELECT throws_ok(
  $$
    SELECT public.committee_decide_under_18_approval(
      'b1000000-0000-4000-8000-000000000001',
      'b5000000-0000-4000-8000-000000000001',
      'approved',
      NULL
    )
  $$,
  '55000',
  'Only open or closed events can accept under-18 approval changes.',
  'committee decision rejects a draft event'
);

SELECT throws_ok(
  format(
    $sql$
      SELECT public.submit_under_18_approval(
        'b1000000-0000-4000-8000-000000000002',
        2032,
        %L::uuid
      )
    $sql$,
    (SELECT under_18_form_id FROM legal_lifecycle_documents)
  ),
  '55000',
  'Only open or closed events can accept under-18 submissions.',
  'player submission rejects an archived event'
);

SELECT * FROM finish();
ROLLBACK;
