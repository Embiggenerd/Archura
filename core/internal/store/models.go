package store

import "time"

type Tenant struct {
	ID             string
	Name           string
	Slug           string
	AllowedOrigins []string
	Status         string
	CreatedAt      time.Time
}

type CreateTenantParams struct {
	Name           string
	Slug           string
	PublishableKey string
	SecretKeyHash  string
	AllowedOrigins []string
	EdgeClaimToken string
}

type AuditEvent struct {
	TenantID     string
	ActorType    string
	ActorID      string
	Action       string
	ResourceType string
	ResourceID   string
	RequestID    string
	Metadata     any
}

type ComponentAuditMetadata struct {
	Mode   string `json:"mode"`
	Status string `json:"status"`
}

type ClientAuditMetadata struct {
	NamespaceBound bool `json:"namespace_bound"`
}

type ComponentSessionAuditMetadata struct {
	Scopes           []string `json:"scopes"`
	ExpiresInSeconds int64    `json:"expires_in_seconds"`
}

type PaymentComponent struct {
	ID             string
	TenantID       string
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
	TenantID       string
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
