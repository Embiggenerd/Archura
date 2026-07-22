package api

import (
	"strings"
	"testing"
)

func TestComponentPolicyRegistry(t *testing.T) {
	tests := []struct {
		path       string
		kind       componentKind
		capability componentCapability
	}{
		{path: "pages/Landing", kind: componentKindPage, capability: componentCapabilityFrontend},
		{path: "pages/Cards", kind: componentKindPage, capability: componentCapabilityFrontend},
		{path: "cards/Card", kind: componentKindComponent, capability: componentCapabilityFrontend},
		{path: "heroes/Hero", kind: componentKindComponent, capability: componentCapabilityFrontend},
		{path: "media/Image", kind: componentKindComponent, capability: componentCapabilityFrontend},
		{path: "payments/StripePayment", kind: componentKindComponent, capability: componentCapabilityBackend},
	}
	for _, test := range tests {
		policy, ok := classifyComponentPath(test.path)
		if !ok || policy.Kind != test.kind || policy.Capability != test.capability {
			t.Fatalf("classifyComponentPath(%q) = %+v, %v", test.path, policy, ok)
		}
	}
	if _, ok := classifyComponentPath("pages/Unknown"); ok {
		t.Fatal("unknown component path was classified")
	}
}

func TestComponentPathValidation(t *testing.T) {
	for _, path := range []string{"pages/Landing", "payments/StripePayment", "custom-group/item_2"} {
		if !componentPathIsWellFormed(path, maxComponentPathSize) {
			t.Fatalf("valid path %q rejected", path)
		}
	}
	for _, path := range []string{"", "Landing", "/Landing", "pages/", "pages//Landing", "pages/../Landing", " pages/Landing", "pages/Landing "} {
		if componentPathIsWellFormed(path, maxComponentPathSize) {
			t.Fatalf("invalid path %q accepted", path)
		}
	}
}

func TestManifestPaidRequirement(t *testing.T) {
	tests := []struct {
		name      string
		input     deployCheckRequest
		needsPaid bool
		known     bool
	}{
		{name: "frontend page", input: deployCheckRequest{TopLevel: "pages/Landing", Uses: []string{"heroes/Hero", "cards/Card"}}, known: true},
		{name: "backend nested", input: deployCheckRequest{TopLevel: "pages/Landing", Uses: []string{"payments/StripePayment"}}, needsPaid: true, known: true},
		{name: "standalone frontend", input: deployCheckRequest{TopLevel: "cards/Card"}, needsPaid: true, known: true},
		{name: "unknown top level", input: deployCheckRequest{TopLevel: "pages/Unknown"}},
		{name: "unknown nested", input: deployCheckRequest{TopLevel: "pages/Landing", Uses: []string{"widgets/Unknown"}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			needsPaid, known := manifestNeedsPaidAccess(test.input)
			if needsPaid != test.needsPaid || known != test.known {
				t.Fatalf("manifestNeedsPaidAccess() = %v, %v; want %v, %v", needsPaid, known, test.needsPaid, test.known)
			}
		})
	}
}

func TestDeployManifestValidationBounds(t *testing.T) {
	if !validDeployManifest(deployCheckRequest{TopLevel: "pages/Landing", Uses: []string{}}) {
		t.Fatal("empty bounded manifest rejected")
	}
	tooManyUses := make([]string, maxManifestUses+1)
	for index := range tooManyUses {
		tooManyUses[index] = "cards/Card"
	}
	if validDeployManifest(deployCheckRequest{TopLevel: "pages/Landing", Uses: tooManyUses}) {
		t.Fatal("manifest above the uses cap accepted")
	}
	if validDeployManifest(deployCheckRequest{TopLevel: "pages/Landing", Uses: []string{
		"cards/" + strings.Repeat("x", maxComponentPathSize),
	}}) {
		t.Fatal("manifest with oversized path accepted")
	}
}
