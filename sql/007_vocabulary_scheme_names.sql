BEGIN;
SET LOCAL lock_timeout = '5s';

-- Reuse the scheme and preferred-label tables already used by Site Types.
INSERT INTO public.vocabulary_schemes (vocabulary_code, scheme_uri, concept_uri_base, source)
SELECT vocabulary_code, 'https://vocab.uclcaal.org/scheme/' || vocabulary_code,
       concept_uri_base, 'workbench_registry'
FROM vocab_workbench.editor_registry
ON CONFLICT (vocabulary_code) DO NOTHING;

-- Apply only to roles already authorised to write Workbench text.
DO $roles$
DECLARE r text;
BEGIN
    FOR r IN SELECT DISTINCT grantee FROM information_schema.table_privileges
             WHERE table_schema='vocab_workbench' AND table_name='editor_texts'
               AND privilege_type='INSERT' AND grantee<>'PUBLIC'
    LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.vocabulary_scheme_labels TO %I', r);
    END LOOP;
END
$roles$;

INSERT INTO vocab_workbench.editor_migrations(version) VALUES ('007_vocabulary_scheme_names')
ON CONFLICT DO NOTHING;

COMMIT;
