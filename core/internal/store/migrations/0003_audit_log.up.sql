CREATE TABLE audit_log (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    actor_type     TEXT NOT NULL CHECK (actor_type IN ('platform_admin', 'tenant')),
    actor_id       TEXT,
    action         TEXT NOT NULL CHECK (action IN (
        'client.created',
        'component.created',
        'component.updated',
        'component_session.created',
        'component_session.revoked'
    )),
    resource_type  TEXT NOT NULL CHECK (resource_type IN ('client', 'component', 'component_session')),
    resource_id    TEXT,
    outcome        TEXT NOT NULL CHECK (outcome = 'success'),
    request_id     TEXT NOT NULL,
    metadata       JSONB NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_tenant_created
    ON audit_log(tenant_id, created_at DESC);
