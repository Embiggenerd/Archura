package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func insertAudit(ctx context.Context, tx pgx.Tx, event AuditEvent) error {
	if event.Outcome == "" {
		event.Outcome = "success"
	}
	metadata, err := auditMetadata(event)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO audit_log (
			organization_id, actor_type, actor_id, action, resource_type,
			resource_id, outcome, request_id, metadata
		) VALUES (
			NULLIF($1, '')::uuid, $2, NULLIF($3, ''), $4, $5,
			NULLIF($6, ''), $7, $8, $9::jsonb
		)`,
		event.OrganizationID, event.ActorType, event.ActorID, event.Action,
		event.ResourceType, event.ResourceID, event.Outcome, event.RequestID, metadata,
	)
	if err != nil {
		return fmt.Errorf("insert audit event %s: %w", event.Action, err)
	}
	return nil
}

func auditMetadata(event AuditEvent) ([]byte, error) {
	switch event.Action {
	case "organization.created", "client.created":
		if _, ok := event.Metadata.(OrganizationAuditMetadata); !ok {
			return nil, errors.New("organization.created requires OrganizationAuditMetadata")
		}
	case "component.created", "component.updated":
		if _, ok := event.Metadata.(ComponentAuditMetadata); !ok {
			return nil, fmt.Errorf("%s requires ComponentAuditMetadata", event.Action)
		}
	case "component_session.created":
		if _, ok := event.Metadata.(ComponentSessionAuditMetadata); !ok {
			return nil, errors.New("component_session.created requires ComponentSessionAuditMetadata")
		}
	case "confirmation.created", "confirmation.verified", "confirmation.verify_rejected",
		"account.created", "session.created", "site_ownership.bound", "site_ownership.rejected",
		"membership.created", "invitation.created", "invitation.accepted", "invitation.declined",
		"invitation.revoked":
		if _, ok := event.Metadata.(EmptyAuditMetadata); !ok {
			return nil, fmt.Errorf("%s requires EmptyAuditMetadata", event.Action)
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

func (s *Store) RecordAudit(ctx context.Context, event AuditEvent) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin record audit: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := insertAudit(ctx, tx, event); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit record audit: %w", err)
	}
	return nil
}
