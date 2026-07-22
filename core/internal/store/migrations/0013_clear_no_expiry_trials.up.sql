-- A free-plan org marked no-expiry has no finite trial window, yet older rows
-- (created under the finite-trial model) still carry trial_started_at /
-- trial_ends_at / serve_grace_ends_at. Those stale timestamps drive a
-- contradictory "N days left" countdown on a plan that never ends. Clear them so
-- the derived state matches the plan. The 0009 shape constraint is satisfied
-- because all three move to NULL together (the "unstarted" branch).
UPDATE organization_billing
SET trial_started_at = NULL,
    trial_ends_at = NULL,
    serve_grace_ends_at = NULL
WHERE free_no_expiry
  AND trial_started_at IS NOT NULL;
