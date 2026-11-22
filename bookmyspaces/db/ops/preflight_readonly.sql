-- READ-ONLY production preflight. Changes nothing.
SELECT current_database() AS db, version() AS postgres;
SELECT to_regclass('crm.app_users') IS NOT NULL AS v2_already_installed;
SELECT count(*) AS legacy_leads FROM public.leads;
SELECT count(*) FILTER (WHERE coalesce(trim(phone),'') = '') AS leads_without_phone FROM public.leads;
SELECT extname, n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE extname IN ('btree_gist','pgcrypto');
SELECT schemaname, count(*) AS tables FROM pg_tables WHERE schemaname IN ('public','crm') GROUP BY 1;
