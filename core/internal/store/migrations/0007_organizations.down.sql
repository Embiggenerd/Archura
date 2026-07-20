ALTER TABLE audit_log
    DROP CONSTRAINT audit_log_actor_type_check,
    DROP CONSTRAINT audit_log_action_check,
    DROP CONSTRAINT audit_log_resource_type_check;

UPDATE audit_log SET actor_type = 'tenant' WHERE actor_type = 'organization';
UPDATE audit_log SET action = 'client.created' WHERE action = 'organization.created';
UPDATE audit_log SET resource_type = 'client' WHERE resource_type = 'organization';
DELETE FROM audit_log WHERE action = 'membership.created' OR resource_type = 'membership';

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
    );

CREATE TABLE account_sites (
    subdomain  TEXT PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT account_sites_one_per_account UNIQUE (account_id)
);

INSERT INTO account_sites (subdomain, account_id, created_at)
SELECT DISTINCT ON (memberships.account_id)
    sites.subdomain, memberships.account_id, sites.created_at
FROM organization_sites sites
JOIN organization_memberships memberships
    ON memberships.organization_id = sites.organization_id
WHERE memberships.is_default
ORDER BY memberships.account_id, sites.created_at, sites.subdomain;

DROP TABLE organization_sites;
DROP TABLE organization_memberships;

ALTER TABLE audit_log RENAME COLUMN organization_id TO tenant_id;
ALTER TABLE component_sessions RENAME COLUMN organization_id TO tenant_id;
ALTER TABLE payment_components RENAME COLUMN organization_id TO tenant_id;
ALTER TABLE organization_api_keys RENAME COLUMN organization_id TO tenant_id;
ALTER TABLE organization_api_keys RENAME TO tenant_api_keys;
ALTER TABLE organizations RENAME TO tenants;
