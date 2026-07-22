ALTER TABLE audit_log
    DROP CONSTRAINT audit_log_action_check;

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
        'admin.organization_plan_updated',
        'admin.organization_deleted',
        'admin.account_deleted'
    ));
