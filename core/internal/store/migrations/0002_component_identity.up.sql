ALTER TABLE tenants
    ADD COLUMN allowed_origins TEXT[] NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX idx_tenant_api_keys_secret_hash
    ON tenant_api_keys(secret_key_hash);

CREATE TABLE payment_components (
    id               TEXT PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    mode             TEXT NOT NULL CHECK (mode IN ('payment', 'subscription')),
    stripe_price_id  TEXT NOT NULL,
    success_url      TEXT NOT NULL,
    cancel_url       TEXT NOT NULL,
    allowed_origins  TEXT[] NOT NULL,
    status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_components_tenant
    ON payment_components(tenant_id);

CREATE TABLE component_sessions (
    id                TEXT PRIMARY KEY,
    token_hash        TEXT NOT NULL UNIQUE,
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    component_id      TEXT NOT NULL REFERENCES payment_components(id) ON DELETE CASCADE,
    external_user_id  TEXT,
    scopes            TEXT[] NOT NULL,
    audience          TEXT NOT NULL,
    allowed_origin    TEXT NOT NULL,
    expires_at        TIMESTAMPTZ NOT NULL,
    revoked_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_component_sessions_tenant
    ON component_sessions(tenant_id);
CREATE INDEX idx_component_sessions_expiry
    ON component_sessions(expires_at);
