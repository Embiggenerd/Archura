package store

import (
	"testing"
	"time"
)

func TestHasPaidComponentAccessUsesRawBillingState(t *testing.T) {
	now := time.Date(2026, 7, 21, 12, 0, 0, 0, time.UTC)
	future := now.Add(time.Hour)
	past := now.Add(-time.Hour)
	tests := []struct {
		name        string
		billing     OrganizationBilling
		capsExempt  bool
		wantAllowed bool
	}{
		{name: "free no expiry remains free", billing: OrganizationBilling{FreeNoExpiry: true}},
		{name: "no-card trial remains free", billing: OrganizationBilling{TrialEndsAt: &future}},
		{name: "active", billing: OrganizationBilling{StripeSubscriptionStatus: "active"}, wantAllowed: true},
		{name: "Stripe trial", billing: OrganizationBilling{StripeSubscriptionStatus: "trialing"}, wantAllowed: true},
		{name: "canceled within period", billing: OrganizationBilling{StripeSubscriptionStatus: "canceled", CurrentPeriodEnd: &future}, wantAllowed: true},
		{name: "canceled after period", billing: OrganizationBilling{StripeSubscriptionStatus: "canceled", CurrentPeriodEnd: &past}},
		{name: "past due", billing: OrganizationBilling{StripeSubscriptionStatus: "past_due", CurrentPeriodEnd: &future}},
		{name: "caps exempt", capsExempt: true, wantAllowed: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := HasPaidComponentAccess(test.billing, test.capsExempt, now); got != test.wantAllowed {
				t.Fatalf("HasPaidComponentAccess() = %v, want %v", got, test.wantAllowed)
			}
		})
	}
}
