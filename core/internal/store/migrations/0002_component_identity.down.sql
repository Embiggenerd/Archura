DROP TABLE IF EXISTS component_sessions;
DROP TABLE IF EXISTS payment_components;
DROP INDEX IF EXISTS idx_tenant_api_keys_secret_hash;
ALTER TABLE tenants DROP COLUMN IF EXISTS allowed_origins;
