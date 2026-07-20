DELETE FROM audit_log
WHERE action IN ('invitation.created', 'invitation.accepted', 'invitation.declined', 'invitation.revoked')
   OR resource_type = 'invitation';

ALTER TABLE audit_log
    DROP CONSTRAINT audit_log_action_check,
    DROP CONSTRAINT audit_log_resource_type_check;

ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_action_check CHECK (action IN (
        'organization.created',
        'membership.created',
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
            'organization', 'membership', 'component', 'component_session',
            'confirmation', 'account', 'session', 'site'
        )
    );

DROP TABLE organization_invitations;
ALTER TABLE accounts DROP COLUMN email_verified_at;
