package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func insertAudit(ctx context.Context, tx pgx.Tx, event AuditEvent) error {
	metadata, err := auditMetadata(event)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO audit_log (
			tenant_id, actor_type, actor_id, action, resource_type,
			resource_id, outcome, request_id, metadata
		) VALUES (
			NULLIF($1, '')::uuid, $2, NULLIF($3, ''), $4, $5,
			NULLIF($6, ''), 'success', $7, $8::jsonb
		)`,
		event.TenantID, event.ActorType, event.ActorID, event.Action,
		event.ResourceType, event.ResourceID, event.RequestID, metadata,
	)
	if err != nil {
		return fmt.Errorf("insert audit event %s: %w", event.Action, err)
	}
	return nil
}

func auditMetadata(event AuditEvent) ([]byte, error) {
	switch event.Action {
	case "client.created":
		if event.Metadata != nil {
			return nil, errors.New("client.created audit metadata must be empty")
		}
		return []byte(`{}`), nil
	case "component.created", "component.updated":
		if _, ok := event.Metadata.(ComponentAuditMetadata); !ok {
			return nil, fmt.Errorf("%s requires ComponentAuditMetadata", event.Action)
		}
	case "component_session.created":
		if _, ok := event.Metadata.(ComponentSessionAuditMetadata); !ok {
			return nil, errors.New("component_session.created requires ComponentSessionAuditMetadata")
		}
	default:
		return nil, fmt.Errorf("unsupported audit action %q", event.Action)
	}
	encoded, err := json.Marshal(event.Metadata)
	if err != nil {
		return nil, fmt.Errorf("encode audit metadata: %w", err)
	}
	return encoded, nil
}
