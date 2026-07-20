package store

import (
	"strings"
	"testing"
)

func TestAuditMetadataIsActionAllowlisted(t *testing.T) {
	clientEncoded, err := auditMetadata(AuditEvent{Action: "client.created", Metadata: ClientAuditMetadata{
		NamespaceBound: true,
	}})
	if err != nil {
		t.Fatal(err)
	}
	if string(clientEncoded) != `{"namespace_bound":true}` {
		t.Fatalf("client metadata = %s", clientEncoded)
	}

	encoded, err := auditMetadata(AuditEvent{Action: "component.created", Metadata: ComponentAuditMetadata{
		Mode: "payment", Status: "active",
	}})
	if err != nil {
		t.Fatal(err)
	}
	value := string(encoded)
	if value != `{"mode":"payment","status":"active"}` {
		t.Fatalf("component metadata = %s", value)
	}
	for _, forbidden := range []string{"external_user_id", "price", "url", "key", "token"} {
		if strings.Contains(value, forbidden) {
			t.Fatalf("audit metadata contains forbidden field %q: %s", forbidden, value)
		}
	}
	empty, err := auditMetadata(AuditEvent{Action: "confirmation.verify_rejected", Metadata: EmptyAuditMetadata{}})
	if err != nil || string(empty) != `{}` {
		t.Fatalf("empty funnel audit metadata = %s, err = %v", empty, err)
	}
}

func TestAuditMetadataRejectsUnknownShapesAndActions(t *testing.T) {
	if _, err := auditMetadata(AuditEvent{Action: "component.created", Metadata: map[string]string{"price_id": "price_123"}}); err == nil {
		t.Fatal("arbitrary component audit metadata must be rejected")
	}
	if _, err := auditMetadata(AuditEvent{Action: "unknown.action"}); err == nil {
		t.Fatal("unknown audit action must be rejected")
	}
	if _, err := auditMetadata(AuditEvent{Action: "client.created", Metadata: struct{}{}}); err == nil {
		t.Fatal("arbitrary client audit metadata must be rejected")
	}
}
