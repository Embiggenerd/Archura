package store

import "time"

type Organization struct {
	ID                  string
	Name                string
	Slug                string
	AllowedOrigins      []string
	Status              string
	CapsExempt          bool
	IsPlatformWorkspace bool
	CreatedAt           time.Time
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
	StaffRole       string
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
	FreeTrialDays            int
	FreeDesignLimit          int
	FreeSiteLimit            int
	FreeNoExpiry             bool
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

type DefaultFreePlan struct {
	TrialDays       int       `json:"trial_days"`
	FreeDesignLimit int       `json:"free_design_limit"`
	FreeSiteLimit   int       `json:"free_site_limit"`
	FreeNoExpiry    bool      `json:"free_no_expiry"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type FreePlanPatch struct {
	TrialDays       *int
	FreeDesignLimit *int
	FreeSiteLimit   *int
	FreeNoExpiry    *bool
}

type OrganizationFreePlanPatch struct {
	FreeTrialDays   *int
	TrialEndsAt     *time.Time
	FreeDesignLimit *int
	FreeSiteLimit   *int
	FreeNoExpiry    *bool
	Reason          string
}

type AdminOrganization struct {
	Organization
	MemberCount int
	DesignCount int
	SiteCount   int
	Sites       []string
	Billing     OrganizationBilling
}

type AdminAccount struct {
	ID              string
	Email           string
	StaffRole       string
	CreatedAt       time.Time
	MembershipCount int
}

type AdminAccountMembership struct {
	OrganizationID string
	Slug           string
	Role           string
	MemberCount    int
	SoleMember     bool
	LastOwner      bool
	Sites          []string
}

type AdminAccountDetail struct {
	AdminAccount
	Memberships []AdminAccountMembership
}

type AdminOrganizationDeleteResult struct {
	ReleasedSites []string
}

type AdminAccountDeleteResult struct {
	DeletedOrganizationIDs []string
	ReleasedSites          []string
}

type AdminDeleteBlocked struct {
	Code             string
	OrganizationID   string
	OrganizationSlug string
}

func (e *AdminDeleteBlocked) Error() string {
	if e.OrganizationSlug != "" {
		return e.Code + ": " + e.OrganizationSlug
	}
	return e.Code
}

type AdminOrganizationMember struct {
	AccountID string
	Email     string
	Role      string
	CreatedAt time.Time
}

type AdminPage[T any] struct {
	Items      []T
	NextCursor string
}

type ForkFinalize struct {
	Status             string
	SourceArtifactKind string
	SourceETag         string
	TemplateRef        string
}

type FreePlanAuditMetadata struct {
	Before any    `json:"before"`
	After  any    `json:"after"`
	Reason string `json:"reason,omitempty"`
}

type ForkAuditMetadata struct {
	SourceOrganizationID string `json:"source_organization_id"`
	SourceDesignID       string `json:"source_design_id"`
	DestinationForkID    string `json:"destination_fork_id"`
	SourceArtifactKind   string `json:"source_artifact_kind,omitempty"`
	SourceETag           string `json:"source_etag,omitempty"`
	TemplateRef          string `json:"template_ref,omitempty"`
}

type DeletionAuditMetadata struct {
	Email                  string   `json:"email,omitempty"`
	Slug                   string   `json:"slug,omitempty"`
	DeletedOrganizationIDs []string `json:"deleted_organization_ids,omitempty"`
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
