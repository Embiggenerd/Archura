package store

import "time"

type Organization struct {
	ID             string
	Name           string
	Slug           string
	AllowedOrigins []string
	Status         string
	CreatedAt      time.Time
}

type CreateOrganizationParams struct {
	Name           string
	Slug           string
	PublishableKey string
	SecretKeyHash  string
	AllowedOrigins []string
	EdgeClaimToken string
}

type AuditEvent struct {
	OrganizationID string
	ActorType      string
	ActorID        string
	Action         string
	ResourceType   string
	ResourceID     string
	Outcome        string
	RequestID      string
	Metadata       any
}

type EmptyAuditMetadata struct{}

type ComponentAuditMetadata struct {
	Mode   string `json:"mode"`
	Status string `json:"status"`
}

type OrganizationAuditMetadata struct {
	NamespaceBound bool `json:"namespace_bound"`
}

type ClientAuditMetadata = OrganizationAuditMetadata

type ComponentSessionAuditMetadata struct {
	Scopes           []string `json:"scopes"`
	ExpiresInSeconds int64    `json:"expires_in_seconds"`
}

type PaymentComponent struct {
	ID             string
	OrganizationID string
	Mode           string
	StripePriceID  string
	SuccessURL     string
	CancelURL      string
	AllowedOrigins []string
	Status         string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type ComponentSession struct {
	ID             string
	TokenHash      string
	OrganizationID string
	ComponentID    string
	ExternalUserID string
	Scopes         []string
	Audience       string
	AllowedOrigin  string
	ExpiresAt      time.Time
	RevokedAt      *time.Time
	CreatedAt      time.Time
}

type RateLimitResult struct {
	Allowed           bool
	Count             int
	RetryAfterSeconds int
}

type Account struct {
	ID              string
	Email           string
	EmailVerifiedAt *time.Time
	CreatedAt       time.Time
}

type EmailConfirmation struct {
	ID        string
	TokenHash string
	Email     string
	Subdomain *string
	ExpiresAt time.Time
	UsedAt    *time.Time
	CreatedAt time.Time
}

type AccountSession struct {
	ID        string
	TokenHash string
	AccountID string
	ExpiresAt time.Time
	RevokedAt *time.Time
	CreatedAt time.Time
}

type VerifyConfirmationParams struct {
	TokenHash        string
	SessionTokenHash string
	SessionExpiresAt time.Time
	PublishableKey   string
	SecretKeyHash    string
	RequestID        string
}

type VerifyConfirmationResult struct {
	Account        Account
	Organization   Organization
	PublishableKey string
	Subdomain      *string
	Session        AccountSession
}

type OrganizationMembership struct {
	AccountID      string
	OrganizationID string
	Role           string
	IsDefault      bool
	CreatedAt      time.Time
}

type AccountOrganization struct {
	Organization
	Role           string
	IsDefault      bool
	PublishableKey string
	Sites          []string
	Billing        OrganizationBilling
}

type OrganizationBilling struct {
	OrganizationID           string
	TrialStartedAt           *time.Time
	TrialEndsAt              *time.Time
	ServeGraceEndsAt         *time.Time
	StripeCustomerID         string
	StripeSubscriptionID     string
	StripeSubscriptionStatus string
	CurrentPeriodEnd         *time.Time
	CancelAtPeriodEnd        bool
	LastStripeEventAt        *time.Time
	CreatedAt                time.Time
	UpdatedAt                time.Time
}

type OrganizationEntitlement struct {
	Status            string
	CanEdit           bool
	CanServe          bool
	CanManageBilling  bool
	TrialEndsAt       *time.Time
	ServeGraceEndsAt  *time.Time
	CurrentPeriodEnd  *time.Time
	CancelAtPeriodEnd bool
	// Raw Stripe subscription status ("trialing", "active", …). The derived
	// Status flattens the Basic trial into "active"; this lets the UI tell the
	// 14-day Basic trial apart from a paid subscription.
	SubscriptionStatus string
}

type StripeSubscriptionUpdate struct {
	OrganizationID    string
	CustomerID        string
	SubscriptionID    string
	Status            string
	CurrentPeriodEnd  *time.Time
	CancelAtPeriodEnd bool
	EventCreatedAt    time.Time
}

type OrganizationInvitation struct {
	ID                 string
	OrganizationID     string
	OrganizationName   string
	Email              string
	Role               string
	InvitedByAccountID string
	InvitedByEmail     string
	Status             string
	ExpiresAt          time.Time
	RespondedAt        *time.Time
	CreatedAt          time.Time
}
