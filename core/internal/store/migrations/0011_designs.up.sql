-- A design: the authoritative record of a top-level embeddable artifact owned
-- by an organization. The heavy content (the canonical artifact + generated
-- embed modules) lives in R2 — this row is identity + metadata, and it is what
-- makes the per-organization design cap countable and enforceable.
CREATE TABLE designs (
    id               TEXT PRIMARY KEY DEFAULT ('dsn_' || replace(gen_random_uuid()::text, '-', '')),
    organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name             TEXT NOT NULL DEFAULT 'Untitled design',
    component_path   TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ
);

-- Counted for the plan cap; the partial index also speeds "My designs".
CREATE INDEX idx_designs_organization
    ON designs(organization_id, updated_at DESC)
    WHERE deleted_at IS NULL;

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
        'billing.payment_failed',
        'design.created',
        'design.deleted'
    )),
    ADD CONSTRAINT audit_log_resource_type_check CHECK (
        resource_type IN (
            'organization', 'membership', 'invitation', 'component', 'component_session',
            'confirmation', 'account', 'session', 'site', 'billing_subscription', 'design'
        )
    );
