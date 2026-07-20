ALTER TABLE accounts ADD COLUMN email_verified_at TIMESTAMPTZ;

UPDATE accounts accounts
SET email_verified_at = verified.created_at
FROM (
    SELECT actor_id, min(created_at) AS created_at
    FROM audit_log
    WHERE actor_type = 'account' AND action = 'confirmation.verified'
    GROUP BY actor_id
) verified
WHERE verified.actor_id = accounts.id::text;

CREATE TABLE organization_invitations (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email                 TEXT NOT NULL,
    role                  TEXT NOT NULL DEFAULT 'member' CHECK (role = 'member'),
    invited_by_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
    expires_at            TIMESTAMPTZ NOT NULL,
    responded_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_organization_invitations_pending
    ON organization_invitations(organization_id, email)
    WHERE status = 'pending';

CREATE INDEX idx_organization_invitations_recipient
    ON organization_invitations(email, created_at DESC)
    WHERE status = 'pending';

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
        'site_ownership.rejected'
    )),
    ADD CONSTRAINT audit_log_resource_type_check CHECK (
        resource_type IN (
            'organization', 'membership', 'invitation', 'component', 'component_session',
            'confirmation', 'account', 'session', 'site'
        )
    );
