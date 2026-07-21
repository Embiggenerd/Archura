DELETE FROM audit_log WHERE action IN (
    'admin.staff_granted',
    'admin.staff_revoked',
    'admin.fork_created',
    'admin.fork_finalized',
    'admin.default_plan_updated',
    'admin.organization_plan_updated'
);

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

DROP INDEX idx_designs_fork_status;
DROP INDEX idx_designs_fork_idempotency;

ALTER TABLE designs
    DROP CONSTRAINT designs_artifact_provenance_check,
    DROP CONSTRAINT designs_ready_fork_provenance_check,
    DROP CONSTRAINT designs_fork_shape_check,
    DROP CONSTRAINT designs_fork_idempotency_key_length_check,
    DROP CONSTRAINT designs_fork_status_check,
    DROP CONSTRAINT designs_source_artifact_kind_check,
    DROP COLUMN fork_status,
    DROP COLUMN fork_idempotency_key,
    DROP COLUMN template_ref,
    DROP COLUMN source_artifact_etag,
    DROP COLUMN source_artifact_kind,
    DROP COLUMN forked_at,
    DROP COLUMN forked_by,
    DROP COLUMN source_org_id,
    DROP COLUMN forked_from;

DROP INDEX idx_organizations_single_platform_workspace;
ALTER TABLE organizations
    DROP COLUMN is_platform_workspace,
    DROP COLUMN caps_exempt;

DROP INDEX idx_accounts_staff_role;
ALTER TABLE accounts
    DROP CONSTRAINT accounts_staff_role_check,
    DROP COLUMN staff_role;

ALTER TABLE organization_billing
    DROP CONSTRAINT organization_billing_free_site_limit_check,
    DROP CONSTRAINT organization_billing_free_design_limit_check,
    DROP CONSTRAINT organization_billing_free_trial_days_check,
    DROP COLUMN free_no_expiry,
    DROP COLUMN free_site_limit,
    DROP COLUMN free_design_limit,
    DROP COLUMN free_trial_days;

DROP TABLE default_free_plan;
