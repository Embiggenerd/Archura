-- Step-up MFA for the platform-owner console. In prod, sensitive admin actions
-- require a recent TOTP verification on the current session.
--
-- mfa_secret is the shared TOTP secret (base32). mfa_activated_at is set once the
-- owner confirms enrollment with a valid code. admin_elevated_until marks how
-- long the current session stays step-up elevated after a successful verify.
ALTER TABLE accounts
    ADD COLUMN mfa_secret TEXT,
    ADD COLUMN mfa_activated_at TIMESTAMPTZ,
    ADD CONSTRAINT accounts_mfa_shape_check CHECK (
        mfa_activated_at IS NULL OR mfa_secret IS NOT NULL
    );

ALTER TABLE account_sessions
    ADD COLUMN admin_elevated_until TIMESTAMPTZ;

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
        'admin.mfa_enrolled',
        'admin.mfa_activated',
        'admin.mfa_verified',
        'admin.mfa_rejected'
    ));
