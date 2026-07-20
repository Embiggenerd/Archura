UPDATE audit_log SET actor_type = 'platform_admin' WHERE actor_type = 'internal';

ALTER TABLE audit_log
    DROP CONSTRAINT audit_log_actor_type_check;

ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_actor_type_check CHECK (
        actor_type IN ('platform_admin', 'organization', 'account', 'anonymous')
    );
