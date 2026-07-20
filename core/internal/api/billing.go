package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/stripe/stripe-go/v86"
	"github.com/stripe/stripe-go/v86/webhook"

	"github.com/archura/core/internal/store"
)

const stripeWebhookBodyLimit = 1 << 20

type billingProvider interface {
	CreateCustomer(context.Context, billingCustomerInput) (string, error)
	CreateCheckout(context.Context, billingCheckoutInput) (string, error)
	CreatePortal(context.Context, string, string) (string, error)
	ParseWebhook([]byte, string, string) (billingWebhook, error)
	RetrieveSubscription(context.Context, string) (billingSubscription, error)
}

type billingCustomerInput struct {
	OrganizationID string
	Name           string
	Email          string
}

type billingCheckoutInput struct {
	OrganizationID string
	CustomerID     string
	PriceID        string
	SuccessURL     string
	CancelURL      string
	IdempotencyKey string
}

type billingWebhook struct {
	ID             string
	Type           string
	CreatedAt      time.Time
	LiveMode       bool
	OrganizationID string
	CustomerID     string
	SubscriptionID string
}

type billingSubscription struct {
	ID                string
	CustomerID        string
	OrganizationID    string
	Status            string
	CurrentPeriodEnd  *time.Time
	CancelAtPeriodEnd bool
}

type stripeBillingProvider struct {
	client *stripe.Client
}

func newStripeBillingProvider(secretKey string) billingProvider {
	return &stripeBillingProvider{client: stripe.NewClient(secretKey)}
}

func (p *stripeBillingProvider) CreateCustomer(ctx context.Context, input billingCustomerInput) (string, error) {
	params := &stripe.CustomerCreateParams{
		Name:     stripe.String(input.Name),
		Email:    stripe.String(input.Email),
		Metadata: map[string]string{"organization_id": input.OrganizationID},
	}
	params.SetIdempotencyKey("archura-customer-" + input.OrganizationID)
	customer, err := p.client.V1Customers.Create(ctx, params)
	if err != nil {
		return "", fmt.Errorf("create Stripe customer: %w", err)
	}
	return customer.ID, nil
}

func (p *stripeBillingProvider) CreateCheckout(ctx context.Context, input billingCheckoutInput) (string, error) {
	params := &stripe.CheckoutSessionCreateParams{
		Customer:          stripe.String(input.CustomerID),
		ClientReferenceID: stripe.String(input.OrganizationID),
		Mode:              stripe.String("subscription"),
		LineItems: []*stripe.CheckoutSessionCreateLineItemParams{{
			Price: stripe.String(input.PriceID), Quantity: stripe.Int64(1),
		}},
		SuccessURL: stripe.String(input.SuccessURL),
		CancelURL:  stripe.String(input.CancelURL),
		Metadata:   map[string]string{"organization_id": input.OrganizationID},
		SubscriptionData: &stripe.CheckoutSessionCreateSubscriptionDataParams{
			Metadata: map[string]string{"organization_id": input.OrganizationID},
		},
	}
	params.SetIdempotencyKey(input.IdempotencyKey)
	session, err := p.client.V1CheckoutSessions.Create(ctx, params)
	if err != nil {
		return "", fmt.Errorf("create Stripe Checkout session: %w", err)
	}
	return session.URL, nil
}

func (p *stripeBillingProvider) CreatePortal(ctx context.Context, customerID, returnURL string) (string, error) {
	session, err := p.client.V1BillingPortalSessions.Create(ctx, &stripe.BillingPortalSessionCreateParams{
		Customer: stripe.String(customerID), ReturnURL: stripe.String(returnURL),
	})
	if err != nil {
		return "", fmt.Errorf("create Stripe portal session: %w", err)
	}
	return session.URL, nil
}

func (p *stripeBillingProvider) ParseWebhook(payload []byte, signature, secret string) (billingWebhook, error) {
	event, err := webhook.ConstructEvent(payload, signature, secret)
	if err != nil {
		return billingWebhook{}, err
	}
	parsed := billingWebhook{
		ID: event.ID, Type: string(event.Type), CreatedAt: time.Unix(event.Created, 0).UTC(), LiveMode: event.Livemode,
	}
	switch parsed.Type {
	case "checkout.session.completed":
		var session stripe.CheckoutSession
		if err := json.Unmarshal(event.Data.Raw, &session); err != nil {
			return billingWebhook{}, err
		}
		parsed.OrganizationID = session.Metadata["organization_id"]
		if session.Customer != nil {
			parsed.CustomerID = session.Customer.ID
		}
		if session.Subscription != nil {
			parsed.SubscriptionID = session.Subscription.ID
		}
	case "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted":
		var subscription stripe.Subscription
		if err := json.Unmarshal(event.Data.Raw, &subscription); err != nil {
			return billingWebhook{}, err
		}
		parsed.OrganizationID = subscription.Metadata["organization_id"]
		parsed.SubscriptionID = subscription.ID
		if subscription.Customer != nil {
			parsed.CustomerID = subscription.Customer.ID
		}
	case "invoice.paid", "invoice.payment_failed":
		var invoice stripe.Invoice
		if err := json.Unmarshal(event.Data.Raw, &invoice); err != nil {
			return billingWebhook{}, err
		}
		if invoice.Customer != nil {
			parsed.CustomerID = invoice.Customer.ID
		}
		if invoice.Parent != nil && invoice.Parent.SubscriptionDetails != nil &&
			invoice.Parent.SubscriptionDetails.Subscription != nil {
			parsed.SubscriptionID = invoice.Parent.SubscriptionDetails.Subscription.ID
			parsed.OrganizationID = invoice.Parent.SubscriptionDetails.Metadata["organization_id"]
		}
	}
	return parsed, nil
}

func (p *stripeBillingProvider) RetrieveSubscription(ctx context.Context, subscriptionID string) (billingSubscription, error) {
	subscription, err := p.client.V1Subscriptions.Retrieve(ctx, subscriptionID, nil)
	if err != nil {
		return billingSubscription{}, fmt.Errorf("retrieve Stripe subscription: %w", err)
	}
	var periodEnd *time.Time
	if subscription.Items != nil {
		var latest int64
		for _, item := range subscription.Items.Data {
			if item.CurrentPeriodEnd > latest {
				latest = item.CurrentPeriodEnd
			}
		}
		if latest > 0 {
			value := time.Unix(latest, 0).UTC()
			periodEnd = &value
		}
	}
	result := billingSubscription{
		ID: subscription.ID, OrganizationID: subscription.Metadata["organization_id"],
		Status: string(subscription.Status), CurrentPeriodEnd: periodEnd,
		CancelAtPeriodEnd: subscription.CancelAtPeriodEnd,
	}
	if subscription.Customer != nil {
		result.CustomerID = subscription.Customer.ID
	}
	return result, nil
}

func (s *Server) handleStartTrial(w http.ResponseWriter, r *http.Request) {
	account, organization, ok := s.accountOrganization(w, r, false)
	if !ok {
		return
	}
	billing, err := s.store.StartOrganizationTrial(r.Context(), organization.ID, s.now().UTC(), store.AuditEvent{
		ActorType: "account", ActorID: account.ID, RequestID: middleware.GetReqID(r.Context()),
		Metadata: store.EmptyAuditMetadata{},
	})
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, billingResponse(billing, organization.Role, s.now().UTC()))
}

func (s *Server) handleOrganizationEntitlement(w http.ResponseWriter, r *http.Request) {
	organizationID := chi.URLParam(r, "organizationID")
	billing, err := s.store.BillingForOrganization(r.Context(), organizationID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "organization_not_found", "The organization was not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=60")
	writeJSON(w, http.StatusOK, entitlementResponse(store.OrganizationEntitlementFor(billing, "", s.now().UTC())))
}

func (s *Server) handleReleaseOrganizationSite(w http.ResponseWriter, r *http.Request) {
	organizationID := chi.URLParam(r, "organizationID")
	subdomain := chi.URLParam(r, "subdomain")
	if !slugPattern.MatchString(subdomain) {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The subdomain is invalid.")
		return
	}
	if err := s.store.ReleaseOrganizationSite(r.Context(), subdomain, organizationID, store.AuditEvent{
		ActorType: "platform_admin", ActorID: "billing_recovery",
		RequestID: middleware.GetReqID(r.Context()), Metadata: store.EmptyAuditMetadata{},
	}); err != nil {
		s.internalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleBillingCheckout(w http.ResponseWriter, r *http.Request) {
	account, organization, ok := s.accountOrganization(w, r, true)
	if !ok {
		return
	}
	if s.billing == nil || s.cfg.StripeBasicPriceID == "" {
		writeError(w, r, http.StatusServiceUnavailable, "billing_unavailable", "Billing is not configured.")
		return
	}
	billing, err := s.store.BillingForOrganization(r.Context(), organization.ID)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if billing.StripeSubscriptionID != "" &&
		billing.StripeSubscriptionStatus != "canceled" &&
		billing.StripeSubscriptionStatus != "incomplete_expired" {
		writeError(w, r, http.StatusConflict, "subscription_exists", "This organization already has a subscription.")
		return
	}
	customerID := billing.StripeCustomerID
	if customerID == "" {
		customerID, err = s.billing.CreateCustomer(r.Context(), billingCustomerInput{
			OrganizationID: organization.ID, Name: organization.Name, Email: account.Email,
		})
		if err != nil {
			s.internalError(w, r, err)
			return
		}
		if err := s.store.SetStripeCustomer(r.Context(), organization.ID, customerID); err != nil {
			s.internalError(w, r, err)
			return
		}
	}
	origin := strings.TrimRight(s.cfg.BillingPublicOrigin, "/")
	hour := s.now().UTC().Truncate(time.Hour).Format("2006010215")
	checkoutURL, err := s.billing.CreateCheckout(r.Context(), billingCheckoutInput{
		OrganizationID: organization.ID, CustomerID: customerID, PriceID: s.cfg.StripeBasicPriceID,
		SuccessURL:     origin + "/dashboard/?organization=" + url.QueryEscape(organization.ID) + "&billing=processing",
		CancelURL:      origin + "/dashboard/?organization=" + url.QueryEscape(organization.ID) + "&billing=canceled",
		IdempotencyKey: "archura-checkout-" + organization.ID + "-" + hour,
	})
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if auditErr := s.store.RecordAudit(r.Context(), store.AuditEvent{
		OrganizationID: organization.ID, ActorType: "account", ActorID: account.ID,
		Action: "billing.checkout_created", ResourceType: "billing_subscription", ResourceID: organization.ID,
		RequestID: middleware.GetReqID(r.Context()), Metadata: store.EmptyAuditMetadata{},
	}); auditErr != nil {
		s.log.Error("billing checkout audit failed", "request_id", middleware.GetReqID(r.Context()), "err", auditErr)
	}
	writeJSON(w, http.StatusCreated, map[string]string{"url": checkoutURL})
}

func (s *Server) handleBillingPortal(w http.ResponseWriter, r *http.Request) {
	account, organization, ok := s.accountOrganization(w, r, true)
	if !ok {
		return
	}
	if s.billing == nil {
		writeError(w, r, http.StatusServiceUnavailable, "billing_unavailable", "Billing is not configured.")
		return
	}
	billing, err := s.store.BillingForOrganization(r.Context(), organization.ID)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if billing.StripeCustomerID == "" {
		writeError(w, r, http.StatusConflict, "billing_customer_missing", "This organization has no billing account yet.")
		return
	}
	returnURL := strings.TrimRight(s.cfg.BillingPublicOrigin, "/") + "/dashboard/?organization=" + url.QueryEscape(organization.ID)
	portalURL, err := s.billing.CreatePortal(r.Context(), billing.StripeCustomerID, returnURL)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if auditErr := s.store.RecordAudit(r.Context(), store.AuditEvent{
		OrganizationID: organization.ID, ActorType: "account", ActorID: account.ID,
		Action: "billing.portal_created", ResourceType: "billing_subscription", ResourceID: organization.ID,
		RequestID: middleware.GetReqID(r.Context()), Metadata: store.EmptyAuditMetadata{},
	}); auditErr != nil {
		s.log.Error("billing portal audit failed", "request_id", middleware.GetReqID(r.Context()), "err", auditErr)
	}
	writeJSON(w, http.StatusCreated, map[string]string{"url": portalURL})
}

func (s *Server) handleStripeWebhook(w http.ResponseWriter, r *http.Request) {
	if s.billing == nil || s.cfg.StripeWebhookSecret == "" || s.store == nil {
		writeError(w, r, http.StatusServiceUnavailable, "billing_unavailable", "Billing is not configured.")
		return
	}
	payload, err := io.ReadAll(http.MaxBytesReader(w, r.Body, stripeWebhookBodyLimit))
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_webhook", "The webhook body is invalid.")
		return
	}
	event, err := s.billing.ParseWebhook(payload, r.Header.Get("Stripe-Signature"), s.cfg.StripeWebhookSecret)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_webhook", "The webhook signature is invalid.")
		return
	}
	expectedLive := strings.HasPrefix(s.cfg.StripeSecretKey, "sk_live_")
	if event.LiveMode != expectedLive {
		writeError(w, r, http.StatusBadRequest, "wrong_stripe_mode", "The webhook mode does not match billing configuration.")
		return
	}
	claimed, err := s.store.ClaimStripeWebhookEvent(r.Context(), event.ID, event.Type, event.CreatedAt)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if !claimed {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	processingErr := s.processStripeWebhook(r.Context(), event, middleware.GetReqID(r.Context()))
	if finishErr := s.store.FinishStripeWebhookEvent(r.Context(), event.ID, processingErr); finishErr != nil {
		s.internalError(w, r, finishErr)
		return
	}
	if processingErr != nil {
		s.internalError(w, r, processingErr)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) processStripeWebhook(ctx context.Context, event billingWebhook, requestID string) error {
	switch event.Type {
	case "checkout.session.completed", "customer.subscription.created", "customer.subscription.updated",
		"customer.subscription.deleted", "invoice.paid", "invoice.payment_failed":
	default:
		return nil
	}
	if event.SubscriptionID == "" {
		return nil
	}
	subscription, err := s.billing.RetrieveSubscription(ctx, event.SubscriptionID)
	if err != nil {
		return err
	}
	organizationID := subscription.OrganizationID
	if organizationID == "" {
		organizationID = event.OrganizationID
	}
	if organizationID == "" && subscription.CustomerID != "" {
		organizationID, err = s.store.OrganizationIDByStripeCustomer(ctx, subscription.CustomerID)
		if err != nil {
			return err
		}
	}
	if organizationID == "" {
		return errors.New("Stripe event has no Archura organization")
	}
	if err := s.store.UpdateStripeSubscription(ctx, store.StripeSubscriptionUpdate{
		OrganizationID: organizationID, CustomerID: subscription.CustomerID,
		SubscriptionID: subscription.ID, Status: subscription.Status,
		CurrentPeriodEnd:  subscription.CurrentPeriodEnd,
		CancelAtPeriodEnd: subscription.CancelAtPeriodEnd, EventCreatedAt: event.CreatedAt,
	}, store.AuditEvent{
		ActorType: "platform_admin", ActorID: "stripe", RequestID: requestID,
		Metadata: store.EmptyAuditMetadata{},
	}); err != nil {
		return err
	}
	if event.Type == "invoice.payment_failed" {
		return s.store.RecordAudit(ctx, store.AuditEvent{
			OrganizationID: organizationID, ActorType: "platform_admin", ActorID: "stripe",
			Action: "billing.payment_failed", ResourceType: "billing_subscription", ResourceID: subscription.ID,
			RequestID: requestID, Metadata: store.EmptyAuditMetadata{},
		})
	}
	return nil
}

func (s *Server) accountOrganization(w http.ResponseWriter, r *http.Request, ownerOnly bool) (store.Account, store.AccountOrganization, bool) {
	account, ok := s.authenticateAccountSession(w, r)
	if !ok {
		return store.Account{}, store.AccountOrganization{}, false
	}
	organizationID := chi.URLParam(r, "organizationID")
	organizations, err := s.store.OrganizationsForAccount(r.Context(), account.ID)
	if err != nil {
		s.internalError(w, r, err)
		return store.Account{}, store.AccountOrganization{}, false
	}
	for _, organization := range organizations {
		if organization.ID != organizationID {
			continue
		}
		if ownerOnly && organization.Role != "owner" {
			writeError(w, r, http.StatusForbidden, "owner_required", "An organization owner must manage billing.")
			return store.Account{}, store.AccountOrganization{}, false
		}
		return account, organization, true
	}
	writeError(w, r, http.StatusNotFound, "organization_not_found", "The organization was not found.")
	return store.Account{}, store.AccountOrganization{}, false
}

func billingResponse(billing store.OrganizationBilling, role string, now time.Time) map[string]any {
	return entitlementResponse(store.OrganizationEntitlementFor(billing, role, now))
}

func entitlementResponse(entitlement store.OrganizationEntitlement) map[string]any {
	return map[string]any{
		"status": entitlement.Status, "can_edit": entitlement.CanEdit, "can_serve": entitlement.CanServe,
		"can_manage_billing": entitlement.CanManageBilling, "trial_ends_at": entitlement.TrialEndsAt,
		"serve_grace_ends_at": entitlement.ServeGraceEndsAt, "current_period_end": entitlement.CurrentPeriodEnd,
		"cancel_at_period_end": entitlement.CancelAtPeriodEnd,
	}
}
