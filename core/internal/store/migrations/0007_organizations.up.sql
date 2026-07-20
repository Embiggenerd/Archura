ALTER TABLE tenants RENAME TO organizations;
ALTER TABLE tenant_api_keys RENAME TO organization_api_keys;
ALTER TABLE organization_api_keys RENAME COLUMN tenant_id TO organization_id;

ALTER TABLE payment_components RENAME COLUMN tenant_id TO organization_id;
ALTER TABLE component_sessions RENAME COLUMN tenant_id TO organization_id;
ALTER TABLE audit_log RENAME COLUMN tenant_id TO organization_id;

CREATE TABLE organization_memberships (
    account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'member')),
    is_default      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, organization_id)
);

CREATE UNIQUE INDEX idx_organization_memberships_default
    ON organization_memberships(account_id)
    WHERE is_default;

CREATE INDEX idx_organization_memberships_organization
    ON organization_memberships(organization_id, created_at);

-- Give every existing account a deterministic default organization. API keys
-- are created lazily by the core with the correct environment prefix the next
-- time that account opens a session.
INSERT INTO organizations (name, slug, allowed_origins)
SELECT
    split_part(email, '@', 1) || '''s organization',
    'org-' || left(replace(id::text, '-', ''), 20),
    '{}'
FROM accounts;

INSERT INTO organization_memberships (account_id, organization_id, role, is_default)
SELECT a.id, o.id, 'owner', true
FROM accounts a
JOIN organizations o ON o.slug = 'org-' || left(replace(a.id::text, '-', ''), 20);

CREATE TABLE organization_sites (
    subdomain       TEXT PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_organization_sites_organization
    ON organization_sites(organization_id, created_at);

INSERT INTO organization_sites (subdomain, organization_id, created_at)
SELECT sites.subdomain, memberships.organization_id, sites.created_at
FROM account_sites sites
JOIN organization_memberships memberships
    ON memberships.account_id = sites.account_id AND memberships.is_default;

DROP TABLE account_sites;

ALTER TABLE audit_log
    DROP CONSTRAINT audit_log_actor_type_check,
    DROP CONSTRAINT audit_log_action_check,
    DROP CONSTRAINT audit_log_resource_type_check;

UPDATE audit_log SET actor_type = 'organization' WHERE actor_type = 'tenant';
UPDATE audit_log SET action = 'organization.created' WHERE action = 'client.created';
UPDATE audit_log SET resource_type = 'organization' WHERE resource_type = 'client';

ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_actor_type_check CHECK (
        actor_type IN ('platform_admin', 'organization', 'account', 'anonymous')
    ),
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

