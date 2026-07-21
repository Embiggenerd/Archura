CREATE TABLE default_free_plan (
    singleton         BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    trial_days         INTEGER NOT NULL CHECK (trial_days >= 0),
    free_design_limit  INTEGER NOT NULL CHECK (free_design_limit >= 0),
    free_site_limit    INTEGER NOT NULL CHECK (free_site_limit >= 0),
    free_no_expiry     BOOLEAN NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO default_free_plan (
    singleton, trial_days, free_design_limit, free_site_limit, free_no_expiry
) VALUES (true, 2, 3, 1, false);

ALTER TABLE organization_billing
    ADD COLUMN free_trial_days INTEGER,
    ADD COLUMN free_design_limit INTEGER,
    ADD COLUMN free_site_limit INTEGER,
    ADD COLUMN free_no_expiry BOOLEAN;

UPDATE organization_billing billing
SET free_trial_days = plan.trial_days,
    free_design_limit = plan.free_design_limit,
    free_site_limit = plan.free_site_limit,
    free_no_expiry = plan.free_no_expiry
FROM default_free_plan plan
WHERE plan.singleton;

INSERT INTO organization_billing (
    organization_id, free_trial_days, free_design_limit, free_site_limit, free_no_expiry
)
SELECT organizations.id, plan.trial_days, plan.free_design_limit,
       plan.free_site_limit, plan.free_no_expiry
FROM organizations
CROSS JOIN default_free_plan plan
WHERE plan.singleton
  AND NOT EXISTS (
      SELECT 1 FROM organization_billing billing
      WHERE billing.organization_id = organizations.id
  );

ALTER TABLE organization_billing
    ALTER COLUMN free_trial_days SET NOT NULL,
    ALTER COLUMN free_design_limit SET NOT NULL,
    ALTER COLUMN free_site_limit SET NOT NULL,
    ALTER COLUMN free_no_expiry SET NOT NULL,
    ADD CONSTRAINT organization_billing_free_trial_days_check CHECK (free_trial_days >= 0),
    ADD CONSTRAINT organization_billing_free_design_limit_check CHECK (free_design_limit >= 0),
    ADD CONSTRAINT organization_billing_free_site_limit_check CHECK (free_site_limit >= 0);

ALTER TABLE accounts
    ADD COLUMN staff_role TEXT,
    ADD CONSTRAINT accounts_staff_role_check CHECK (staff_role IN ('platform_owner'));

CREATE INDEX idx_accounts_staff_role ON accounts(staff_role) WHERE staff_role IS NOT NULL;

ALTER TABLE organizations
    ADD COLUMN caps_exempt BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN is_platform_workspace BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX idx_organizations_single_platform_workspace
    ON organizations ((is_platform_workspace))
    WHERE is_platform_workspace;

ALTER TABLE designs
    ADD COLUMN forked_from TEXT,
    ADD COLUMN source_org_id TEXT,
    ADD COLUMN forked_by TEXT,
    ADD COLUMN forked_at TIMESTAMPTZ,
    ADD COLUMN source_artifact_kind TEXT,
    ADD COLUMN source_artifact_etag TEXT,
    ADD COLUMN template_ref TEXT,
    ADD COLUMN fork_idempotency_key TEXT,
    ADD COLUMN fork_status TEXT,
    ADD CONSTRAINT designs_source_artifact_kind_check
        CHECK (source_artifact_kind IN ('published', 'draft', 'template')),
    ADD CONSTRAINT designs_fork_status_check
        CHECK (fork_status IN ('pending', 'ready', 'failed')),
    ADD CONSTRAINT designs_fork_idempotency_key_length_check
        CHECK (fork_idempotency_key IS NULL OR char_length(fork_idempotency_key) BETWEEN 1 AND 128),
    ADD CONSTRAINT designs_fork_shape_check CHECK (
        (
            fork_idempotency_key IS NULL
            AND fork_status IS NULL
            AND forked_from IS NULL
            AND source_org_id IS NULL
            AND forked_by IS NULL
            AND forked_at IS NULL
            AND source_artifact_kind IS NULL
            AND source_artifact_etag IS NULL
            AND template_ref IS NULL
        )
        OR
        (
            fork_idempotency_key IS NOT NULL
            AND fork_status IS NOT NULL
            AND forked_from IS NOT NULL
            AND source_org_id IS NOT NULL
            AND forked_by IS NOT NULL
            AND forked_at IS NOT NULL
        )
    ),
    ADD CONSTRAINT designs_ready_fork_provenance_check CHECK (
        fork_status IS DISTINCT FROM 'ready' OR source_artifact_kind IS NOT NULL
    ),
    ADD CONSTRAINT designs_artifact_provenance_check CHECK (
        source_artifact_kind IS NULL
        OR (
            source_artifact_kind IN ('published', 'draft')
            AND source_artifact_etag IS NOT NULL
            AND template_ref IS NULL
        )
        OR (
            source_artifact_kind = 'template'
            AND template_ref IS NOT NULL
            AND source_artifact_etag IS NULL
        )
    );

CREATE UNIQUE INDEX idx_designs_fork_idempotency
    ON designs(fork_idempotency_key)
    WHERE fork_idempotency_key IS NOT NULL;

CREATE INDEX idx_designs_fork_status
    ON designs(fork_status, updated_at DESC)
    WHERE fork_idempotency_key IS NOT NULL;

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
        'design.deleted',
        'admin.staff_granted',
        'admin.staff_revoked',
        'admin.fork_created',
        'admin.fork_finalized',
        'admin.default_plan_updated',
        'admin.organization_plan_updated'
    )),
    ADD CONSTRAINT audit_log_resource_type_check CHECK (
        resource_type IN (
            'organization', 'membership', 'invitation', 'component', 'component_session',
            'confirmation', 'account', 'session', 'site', 'billing_subscription', 'design',
            'free_plan'
        )
    );
