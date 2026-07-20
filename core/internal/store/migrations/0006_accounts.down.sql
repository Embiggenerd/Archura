DELETE FROM audit_log
WHERE action IN (
    'confirmation.created',
    'confirmation.verified',
    'confirmation.verify_rejected',
    'account.created',
    'session.created',
    'site_ownership.bound',
    'site_ownership.rejected'
);

DROP TABLE IF EXISTS account_sites;
DROP TABLE IF EXISTS account_sessions;
DROP TABLE IF EXISTS email_confirmations;
DROP TABLE IF EXISTS accounts;

ALTER TABLE audit_log
    DROP CONSTRAINT audit_log_actor_type_check,
    DROP CONSTRAINT audit_log_action_check,
    DROP CONSTRAINT audit_log_resource_type_check,
    DROP CONSTRAINT audit_log_outcome_check;

ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_actor_type_check CHECK (
        actor_type IN ('platform_admin', 'tenant')
    ),
    ADD CONSTRAINT audit_log_action_check CHECK (action IN (
        'client.created',
        'component.created',
        'component.updated',
        'component_session.created',
        'component_session.revoked'
    )),
    ADD CONSTRAINT audit_log_resource_type_check CHECK (
        resource_type IN ('client', 'component', 'component_session')
    ),
    ADD CONSTRAINT audit_log_outcome_check CHECK (outcome = 'success');
