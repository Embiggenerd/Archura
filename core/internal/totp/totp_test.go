package totp

import (
	"testing"
	"time"
)

func TestCodeMatchesRFC6238Vector(t *testing.T) {
	// RFC 6238 test secret "12345678901234567890" (ASCII) in base32, SHA-1.
	secret := encoding.EncodeToString([]byte("12345678901234567890"))
	at := time.Unix(59, 0)
	code, err := Code(secret, at)
	if err != nil {
		t.Fatal(err)
	}
	if code != "287082" {
		t.Fatalf("code = %q, want 287082", code)
	}
}

func TestValidateWindowAndRejection(t *testing.T) {
	secret, err := GenerateSecret()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	code, err := Code(secret, now)
	if err != nil {
		t.Fatal(err)
	}
	if !Validate(secret, code, now) {
		t.Fatal("expected current code to validate")
	}
	// One step earlier is still accepted (clock skew tolerance).
	if !Validate(secret, code, now.Add(step)) {
		t.Fatal("expected code to validate one step later")
	}
	// Two steps away is rejected.
	if Validate(secret, code, now.Add(3*step)) {
		t.Fatal("expected stale code to be rejected")
	}
	if Validate(secret, "000000", now) && func() bool { c, _ := Code(secret, now); return c != "000000" }() {
		t.Fatal("expected wrong code to be rejected")
	}
}

func TestProvisioningURI(t *testing.T) {
	uri := ProvisioningURI("ABC", "owner@example.com", "Archura")
	if uri == "" || uri[:8] != "otpauth:" {
		t.Fatalf("unexpected uri: %q", uri)
	}
}
