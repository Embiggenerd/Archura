package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	TrialDuration      = 30 * 24 * time.Hour
	ServingGracePeriod = 7 * 24 * time.Hour
)

func OrganizationEntitlementFor(billing OrganizationBilling, role string, now time.Time) OrganizationEntitlement {
	entitlement := OrganizationEntitlement{
		Status:            "unstarted",
		CanEdit:           true,
		CanManageBilling:  role == "owner",
		TrialEndsAt:       billing.TrialEndsAt,
		ServeGraceEndsAt:  billing.ServeGraceEndsAt,
		CurrentPeriodEnd:  billing.CurrentPeriodEnd,
		CancelAtPeriodEnd: billing.CancelAtPeriodEnd,
	}

	switch billing.StripeSubscriptionStatus {
	case "active", "trialing":
		entitlement.Status = "active"
		entitlement.CanEdit = true
		entitlement.CanServe = true
		return entitlement
	case "past_due":
		graceStartedAt := billing.LastStripeEventAt
		if graceStartedAt == nil {
			graceStartedAt = billing.CurrentPeriodEnd
		}
		if graceStartedAt != nil && now.Before(graceStartedAt.Add(ServingGracePeriod)) {
			entitlement.Status = "grace"
			entitlement.CanEdit = false
			entitlement.CanServe = true
			graceEnd := graceStartedAt.Add(ServingGracePeriod)
			entitlement.ServeGraceEndsAt = &graceEnd
			return entitlement
		}
		entitlement.Status = "expired"
		entitlement.CanEdit = false
		entitlement.CanServe = false
		if graceStartedAt != nil {
			graceEnd := graceStartedAt.Add(ServingGracePeriod)
			entitlement.ServeGraceEndsAt = &graceEnd
		}
		return entitlement
	case "canceled":
		if billing.CurrentPeriodEnd != nil && now.Before(*billing.CurrentPeriodEnd) {
			entitlement.Status = "active"
			entitlement.CanEdit = true
			entitlement.CanServe = true
			graceEnd := billing.CurrentPeriodEnd.Add(ServingGracePeriod)
			entitlement.ServeGraceEndsAt = &graceEnd
			return entitlement
		}
		if billing.CurrentPeriodEnd != nil && now.Before(billing.CurrentPeriodEnd.Add(ServingGracePeriod)) {
			entitlement.Status = "grace"
			entitlement.CanEdit = false
			entitlement.CanServe = true
			graceEnd := billing.CurrentPeriodEnd.Add(ServingGracePeriod)
			entitlement.ServeGraceEndsAt = &graceEnd
			return entitlement
		}
		entitlement.Status = "expired"
		entitlement.CanEdit = false
		entitlement.CanServe = false
		if billing.CurrentPeriodEnd != nil {
			graceEnd := billing.CurrentPeriodEnd.Add(ServingGracePeriod)
			entitlement.ServeGraceEndsAt = &graceEnd
		}
		return entitlement
	}

	if billing.TrialEndsAt == nil {
		return entitlement
	}
	if now.Before(*billing.TrialEndsAt) {
		entitlement.Status = "trialing"
		entitlement.CanEdit = true
		entitlement.CanServe = true
		return entitlement
	}
	if billing.ServeGraceEndsAt != nil && now.Before(*billing.ServeGraceEndsAt) {
		entitlement.Status = "grace"
		entitlement.CanEdit = false
		entitlement.CanServe = true
		return entitlement
	}
	entitlement.Status = "expired"
	entitlement.CanEdit = false
	entitlement.CanServe = false
	return entitlement
}

func (s *Store) BillingForOrganization(ctx context.Context, organizationID string) (OrganizationBilling, error) {
	billing := OrganizationBilling{OrganizationID: organizationID}
	err := s.Pool.QueryRow(ctx, `
		SELECT organization_id::text, trial_started_at, trial_ends_at, serve_grace_ends_at,
			COALESCE(stripe_customer_id, ''), COALESCE(stripe_subscription_id, ''),
			COALESCE(stripe_subscription_status, ''), current_period_end,
			cancel_at_period_end, last_stripe_event_at, created_at, updated_at
		FROM organization_billing
		WHERE organization_id = $1::uuid`, organizationID).Scan(
		&billing.OrganizationID, &billing.TrialStartedAt, &billing.TrialEndsAt,
		&billing.ServeGraceEndsAt, &billing.StripeCustomerID, &billing.StripeSubscriptionID,
		&billing.StripeSubscriptionStatus, &billing.CurrentPeriodEnd,
		&billing.CancelAtPeriodEnd, &billing.LastStripeEventAt, &billing.CreatedAt, &billing.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		var exists bool
		if checkErr := s.Pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM organizations WHERE id = $1::uuid)`, organizationID,
		).Scan(&exists); checkErr != nil {
			return OrganizationBilling{}, fmt.Errorf("check billing organization: %w", checkErr)
		}
		if !exists {
			return OrganizationBilling{}, ErrNotFound
		}
		return billing, nil
	}
	if err != nil {
		return OrganizationBilling{}, fmt.Errorf("get organization billing: %w", err)
	}
	return billing, nil
}

func (s *Store) StartOrganizationTrial(
	ctx context.Context,
	organizationID string,
	now time.Time,
	audit AuditEvent,
) (OrganizationBilling, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return OrganizationBilling{}, fmt.Errorf("begin trial: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	trialEndsAt := now.Add(TrialDuration)
	graceEndsAt := trialEndsAt.Add(ServingGracePeriod)
	result, err := tx.Exec(ctx, `
		INSERT INTO organization_billing (
			organization_id, trial_started_at, trial_ends_at, serve_grace_ends_at
		)
		VALUES ($1::uuid, $2, $3, $4)
		ON CONFLICT (organization_id) DO UPDATE
		SET trial_started_at = EXCLUDED.trial_started_at,
			trial_ends_at = EXCLUDED.trial_ends_at,
			serve_grace_ends_at = EXCLUDED.serve_grace_ends_at,
			updated_at = now()
		WHERE organization_billing.trial_started_at IS NULL`,
		organizationID, now, trialEndsAt, graceEndsAt,
	)
	if err != nil {
		return OrganizationBilling{}, fmt.Errorf("start organization trial: %w", err)
	}
	if result.RowsAffected() == 1 {
		audit.OrganizationID = organizationID
		audit.Action = "billing.trial_started"
		audit.ResourceType = "billing_subscription"
		audit.ResourceID = organizationID
		if err := insertAudit(ctx, tx, audit); err != nil {
			return OrganizationBilling{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return OrganizationBilling{}, fmt.Errorf("commit trial: %w", err)
	}
	return s.BillingForOrganization(ctx, organizationID)
}

func (s *Store) SetStripeCustomer(ctx context.Context, organizationID, customerID string) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO organization_billing (organization_id, stripe_customer_id)
		VALUES ($1::uuid, $2)
		ON CONFLICT (organization_id) DO UPDATE
		SET stripe_customer_id = COALESCE(organization_billing.stripe_customer_id, EXCLUDED.stripe_customer_id),
			updated_at = now()`, organizationID, customerID)
	if err != nil {
		return fmt.Errorf("set stripe customer: %w", err)
	}
	return nil
}

func (s *Store) UpdateStripeSubscription(ctx context.Context, update StripeSubscriptionUpdate, audit AuditEvent) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin stripe subscription update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	result, err := tx.Exec(ctx, `
		UPDATE organization_billing
		SET stripe_customer_id = CASE WHEN $2 = '' THEN stripe_customer_id ELSE $2 END,
			stripe_subscription_id = CASE WHEN $3 = '' THEN stripe_subscription_id ELSE $3 END,
			stripe_subscription_status = $4,
			current_period_end = $5,
			cancel_at_period_end = $6,
			last_stripe_event_at = $7,
			updated_at = now()
		WHERE organization_id = $1::uuid
		  AND (last_stripe_event_at IS NULL OR last_stripe_event_at <= $7)`,
		update.OrganizationID, update.CustomerID, update.SubscriptionID, update.Status,
		update.CurrentPeriodEnd, update.CancelAtPeriodEnd, update.EventCreatedAt,
	)
	if err != nil {
		return fmt.Errorf("update stripe subscription: %w", err)
	}
	if result.RowsAffected() == 0 {
		return nil
	}
	audit.OrganizationID = update.OrganizationID
	audit.Action = "billing.subscription_updated"
	audit.ResourceType = "billing_subscription"
	audit.ResourceID = update.SubscriptionID
	if err := insertAudit(ctx, tx, audit); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit stripe subscription update: %w", err)
	}
	return nil
}

func (s *Store) OrganizationIDByStripeCustomer(ctx context.Context, customerID string) (string, error) {
	var organizationID string
	if err := s.Pool.QueryRow(ctx, `
		SELECT organization_id::text FROM organization_billing WHERE stripe_customer_id = $1`,
		customerID,
	).Scan(&organizationID); errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	} else if err != nil {
		return "", fmt.Errorf("find stripe customer organization: %w", err)
	}
	return organizationID, nil
}

// ClaimStripeWebhookEvent returns false when the event was already processed.
// Failed or interrupted attempts are safely claimed again.
func (s *Store) ClaimStripeWebhookEvent(ctx context.Context, eventID, eventType string, createdAt time.Time) (bool, error) {
	var status string
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO stripe_webhook_events (event_id, event_type, event_created)
		VALUES ($1, $2, $3)
		ON CONFLICT (event_id) DO UPDATE
		SET status = 'processing', attempts = stripe_webhook_events.attempts + 1,
			last_error = NULL, received_at = now()
		WHERE stripe_webhook_events.status = 'failed'
		   OR (stripe_webhook_events.status = 'processing'
		       AND stripe_webhook_events.received_at < now() - interval '5 minutes')
		RETURNING status`, eventID, eventType, createdAt).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim stripe webhook event: %w", err)
	}
	return true, nil
}

func (s *Store) FinishStripeWebhookEvent(ctx context.Context, eventID string, processingErr error) error {
	status := "processed"
	var message *string
	if processingErr != nil {
		status = "failed"
		text := processingErr.Error()
		if len(text) > 500 {
			text = text[:500]
		}
		message = &text
	}
	_, err := s.Pool.Exec(ctx, `
		UPDATE stripe_webhook_events
		SET status = $2, last_error = $3,
			processed_at = CASE WHEN $2 = 'processed' THEN now() ELSE NULL END
		WHERE event_id = $1`, eventID, status, message)
	if err != nil {
		return fmt.Errorf("finish stripe webhook event: %w", err)
	}
	return nil
}
