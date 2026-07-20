-- Machine-invoked endpoints (Worker cron/serving, authenticated by
-- CORE_INTERNAL_KEY) audit truthfully as 'internal' instead of borrowing
-- 'platform_admin'.
ALTER TABLE audit_log
    DROP CONSTRAINT audit_log_actor_type_check;

ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_actor_type_check CHECK (
        actor_type IN ('platform_admin', 'organization', 'account', 'anonymous', 'internal')
    );
