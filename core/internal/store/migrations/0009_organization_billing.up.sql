CREATE TABLE organization_billing (
    organization_id            UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    trial_started_at           TIMESTAMPTZ,
    trial_ends_at              TIMESTAMPTZ,
    serve_grace_ends_at        TIMESTAMPTZ,
    stripe_customer_id         TEXT UNIQUE,
    stripe_subscription_id     TEXT UNIQUE,
    stripe_subscription_status TEXT,
    current_period_end         TIMESTAMPTZ,
    cancel_at_period_end       BOOLEAN NOT NULL DEFAULT false,
    last_stripe_event_at       TIMESTAMPTZ,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (trial_started_at IS NULL AND trial_ends_at IS NULL AND serve_grace_ends_at IS NULL)
        OR
        (trial_started_at IS NOT NULL AND trial_ends_at > trial_started_at
            AND serve_grace_ends_at >= trial_ends_at)
    )
);

-- Organizations that already published before billing launches receive a
-- complete 30-day trial from the migration date.
INSERT INTO organization_billing (
    organization_id, trial_started_at, trial_ends_at, serve_grace_ends_at
)
SELECT DISTINCT organization_id, now(), now() + interval '30 days', now() + interval '37 days'
FROM organization_sites;

CREATE TABLE stripe_webhook_events (
    event_id       TEXT PRIMARY KEY,
    event_type     TEXT NOT NULL,
    event_created  TIMESTAMPTZ NOT NULL,
    status         TEXT NOT NULL DEFAULT 'processing'
                   CHECK (status IN ('processing', 'processed', 'failed')),
    attempts       INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
    last_error     TEXT,
    received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at   TIMESTAMPTZ
);

CREATE INDEX idx_stripe_webhook_events_status_received
    ON stripe_webhook_events(status, received_at);

ALTER TABLE audit_log
    DROP CONSTRAINT audit_log_action_check,
    DROP CONSTRAINT audit_log_resource_type_check;

ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_action_check CHECK (action IN (
        'organization.created',
        'membership.created',
        'invitation.created',
        'invitation.accepted',
        'invitation.declined',
        'invitation.revoked',
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
        'site_ownership.rejected',
        'site_ownership.released',
        'billing.trial_started',
        'billing.checkout_created',
        'billing.portal_created',
        'billing.subscription_updated',
        'billing.payment_failed'
    )),
    ADD CONSTRAINT audit_log_resource_type_check CHECK (
        resource_type IN (
            'organization', 'membership', 'invitation', 'component', 'component_session',
            'confirmation', 'account', 'session', 'site', 'billing_subscription'
        )
    );
