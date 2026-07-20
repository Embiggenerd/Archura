CREATE TABLE accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE email_confirmations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash  TEXT NOT NULL UNIQUE,
    email       TEXT NOT NULL,
    subdomain   TEXT,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_confirmations_expiry
    ON email_confirmations(expires_at);

CREATE TABLE account_sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash  TEXT NOT NULL UNIQUE,
    account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_account_sessions_account
    ON account_sessions(account_id, created_at DESC);

CREATE INDEX idx_account_sessions_expiry
    ON account_sessions(expires_at);

CREATE TABLE account_sites (
    subdomain   TEXT PRIMARY KEY,
    account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT account_sites_one_per_account UNIQUE (account_id)
);

ALTER TABLE audit_log
    DROP CONSTRAINT audit_log_actor_type_check,
    DROP CONSTRAINT audit_log_action_check,
    DROP CONSTRAINT audit_log_resource_type_check,
    DROP CONSTRAINT audit_log_outcome_check;

ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_actor_type_check CHECK (
        actor_type IN ('platform_admin', 'tenant', 'account', 'anonymous')
    ),
    ADD CONSTRAINT audit_log_action_check CHECK (action IN (
        'client.created',
        'component.created',
        'component.updated',
        'component_session.created',
        'component_session.revoked',
        'confirmation.created',
        'confirmation.verified',
        'confirmation.verify_rejected',
        'account.created',
        'session.created',
        'site_ownership.bound',
        'site_ownership.rejected'
    )),
    ADD CONSTRAINT audit_log_resource_type_check CHECK (
        resource_type IN (
            'client', 'component', 'component_session',
            'confirmation', 'account', 'session', 'site'
        )
    ),
    ADD CONSTRAINT audit_log_outcome_check CHECK (outcome IN ('success', 'rejected'));
