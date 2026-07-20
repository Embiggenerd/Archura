package auth

import "testing"

func TestGenerateUsesEnvironmentPrefixAndRandomValues(t *testing.T) {
	first, err := Generate("sk", "dev")
	if err != nil {
		t.Fatal(err)
	}
	second, err := Generate("sk", "dev")
	if err != nil {
		t.Fatal(err)
	}
	if !HasKind(first, "sk") || first[:8] != "sk_test_" {
		t.Fatalf("development secret = %q, want sk_test_ prefix", first)
	}
	if first == second {
		t.Fatal("generated keys must be unique")
	}

	live, err := Generate("ct", "prod")
	if err != nil {
		t.Fatal(err)
	}
	if live[:8] != "ct_live_" {
		t.Fatalf("production token = %q, want ct_live_ prefix", live)
	}
	if HasKindForEnv(first, "sk", "prod") {
		t.Fatal("test key must not be accepted as a production key")
	}
}

func TestHashAndEqual(t *testing.T) {
	if Hash("secret") == "secret" {
		t.Fatal("hash must not return plaintext")
	}
	if !Equal(Hash("secret"), Hash("secret")) {
		t.Fatal("equal hashes should compare equal")
	}
	if Equal(Hash("secret"), Hash("different")) {
		t.Fatal("different hashes should not compare equal")
	}
}

func TestAccountTokenKindsRoundTrip(t *testing.T) {
	for _, kind := range []string{"cfm", "sess"} {
		token, err := Generate(kind, "dev")
		if err != nil {
			t.Fatalf("Generate(%q): %v", kind, err)
		}
		if !HasKindForEnv(token, kind, "dev") || HasKindForEnv(token, kind, "prod") {
			t.Fatalf("generated %s token has incorrect environment binding: %q", kind, token)
		}
	}
}
