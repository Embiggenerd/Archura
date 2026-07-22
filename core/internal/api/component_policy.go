package api

import "strings"

type componentKind string

const (
	componentKindPage      componentKind = "page"
	componentKindComponent componentKind = "component"
)

type componentCapability string

const (
	componentCapabilityFrontend componentCapability = "frontend"
	componentCapabilityBackend  componentCapability = "backend"
)

type componentPolicy struct {
	Kind       componentKind
	Capability componentCapability
}

// componentPolicies is Core's authoritative product-tier registry. A new
// editor component must be labeled here before Core will allow it to deploy.
var componentPolicies = map[string]componentPolicy{
	"pages/Landing":          {Kind: componentKindPage, Capability: componentCapabilityFrontend},
	"pages/Cards":            {Kind: componentKindPage, Capability: componentCapabilityFrontend},
	"cards/Card":             {Kind: componentKindComponent, Capability: componentCapabilityFrontend},
	"heroes/Hero":            {Kind: componentKindComponent, Capability: componentCapabilityFrontend},
	"media/Image":            {Kind: componentKindComponent, Capability: componentCapabilityFrontend},
	"payments/StripePayment": {Kind: componentKindComponent, Capability: componentCapabilityBackend},
}

func classifyComponentPath(path string) (componentPolicy, bool) {
	policy, ok := componentPolicies[strings.TrimSpace(path)]
	return policy, ok
}

func componentPathIsWellFormed(path string, maxLength int) bool {
	if path == "" || len(path) > maxLength || strings.TrimSpace(path) != path {
		return false
	}
	segments := strings.Split(path, "/")
	if len(segments) < 2 {
		return false
	}
	for _, segment := range segments {
		if segment == "" {
			return false
		}
		for _, char := range segment {
			if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
				(char >= '0' && char <= '9') || char == '-' || char == '_' {
				continue
			}
			return false
		}
	}
	return true
}
