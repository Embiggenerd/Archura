package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateOrganizationInvitation(
	ctx context.Context,
	organizationID, invitedByAccountID, email string,
	expiresAt time.Time,
	audit AuditEvent,
) (OrganizationInvitation, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return OrganizationInvitation{}, fmt.Errorf("begin create invitation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var owner bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM organization_memberships
			WHERE organization_id = $1::uuid AND account_id = $2::uuid AND role = 'owner'
		)`, organizationID, invitedByAccountID).Scan(&owner); err != nil {
		return OrganizationInvitation{}, fmt.Errorf("check invitation owner: %w", err)
	}
	if !owner {
		return OrganizationInvitation{}, ErrNotFound
	}

	var member bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM organization_memberships memberships
			JOIN accounts ON accounts.id = memberships.account_id
			WHERE memberships.organization_id = $1::uuid AND accounts.email = $2
		)`, organizationID, email).Scan(&member); err != nil {
		return OrganizationInvitation{}, fmt.Errorf("check existing member: %w", err)
	}
	if member {
		return OrganizationInvitation{}, ErrAlreadyMember
	}

	var invitation OrganizationInvitation
	err = tx.QueryRow(ctx, `
		INSERT INTO organization_invitations (
			organization_id, email, role, invited_by_account_id, expires_at
		) VALUES ($1::uuid, $2, 'member', $3::uuid, $4)
		ON CONFLICT (organization_id, email) WHERE status = 'pending'
		DO UPDATE SET
			invited_by_account_id = EXCLUDED.invited_by_account_id,
			expires_at = EXCLUDED.expires_at,
			responded_at = NULL
		RETURNING id::text, organization_id::text, email, role,
			invited_by_account_id::text, status, expires_at, responded_at, created_at`,
		organizationID, email, invitedByAccountID, expiresAt,
	).Scan(
		&invitation.ID, &invitation.OrganizationID, &invitation.Email, &invitation.Role,
		&invitation.InvitedByAccountID, &invitation.Status, &invitation.ExpiresAt,
		&invitation.RespondedAt, &invitation.CreatedAt,
	)
	if err != nil {
		return OrganizationInvitation{}, mapStoreError("create invitation", err)
	}
	if err := tx.QueryRow(ctx, `
		SELECT organizations.name, accounts.email
		FROM organizations
		JOIN accounts ON accounts.id = $2::uuid
		WHERE organizations.id = $1::uuid`, organizationID, invitedByAccountID,
	).Scan(&invitation.OrganizationName, &invitation.InvitedByEmail); err != nil {
		return OrganizationInvitation{}, mapStoreError("load invitation display fields", err)
	}

	audit.OrganizationID = organizationID
	audit.ResourceID = invitation.ID
	if err := insertAudit(ctx, tx, audit); err != nil {
		return OrganizationInvitation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return OrganizationInvitation{}, fmt.Errorf("commit create invitation: %w", err)
	}
	return invitation, nil
}

func (s *Store) PendingInvitationsForEmail(ctx context.Context, email string) ([]OrganizationInvitation, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT invitations.id::text, invitations.organization_id::text, organizations.name,
			invitations.email, invitations.role, COALESCE(invitations.invited_by_account_id::text, ''),
			COALESCE(inviter.email, ''), invitations.status, invitations.expires_at,
			invitations.responded_at, invitations.created_at
		FROM organization_invitations invitations
		JOIN organizations ON organizations.id = invitations.organization_id
		LEFT JOIN accounts inviter ON inviter.id = invitations.invited_by_account_id
		WHERE invitations.email = $1 AND invitations.status = 'pending'
			AND invitations.expires_at > now()
		ORDER BY invitations.created_at DESC`, email)
	if err != nil {
		return nil, fmt.Errorf("list pending invitations: %w", err)
	}
	defer rows.Close()

	invitations := make([]OrganizationInvitation, 0)
	for rows.Next() {
		var invitation OrganizationInvitation
		if err := rows.Scan(
			&invitation.ID, &invitation.OrganizationID, &invitation.OrganizationName,
			&invitation.Email, &invitation.Role, &invitation.InvitedByAccountID,
			&invitation.InvitedByEmail, &invitation.Status, &invitation.ExpiresAt,
			&invitation.RespondedAt, &invitation.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan pending invitation: %w", err)
		}
		invitations = append(invitations, invitation)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pending invitations: %w", err)
	}
	return invitations, nil
}

func (s *Store) RespondToOrganizationInvitation(
	ctx context.Context,
	invitationID string,
	account Account,
	accept bool,
	audit AuditEvent,
) (OrganizationInvitation, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return OrganizationInvitation{}, fmt.Errorf("begin respond invitation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var invitation OrganizationInvitation
	err = tx.QueryRow(ctx, `
		SELECT invitations.id::text, invitations.organization_id::text, organizations.name,
			invitations.email, invitations.role, COALESCE(invitations.invited_by_account_id::text, ''),
			COALESCE(inviter.email, ''), invitations.status, invitations.expires_at,
			invitations.responded_at, invitations.created_at
		FROM organization_invitations invitations
		JOIN organizations ON organizations.id = invitations.organization_id
		LEFT JOIN accounts inviter ON inviter.id = invitations.invited_by_account_id
		WHERE invitations.id = $1::uuid
		FOR UPDATE OF invitations`, invitationID,
	).Scan(
		&invitation.ID, &invitation.OrganizationID, &invitation.OrganizationName,
		&invitation.Email, &invitation.Role, &invitation.InvitedByAccountID,
		&invitation.InvitedByEmail, &invitation.Status, &invitation.ExpiresAt,
		&invitation.RespondedAt, &invitation.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return OrganizationInvitation{}, ErrNotFound
	}
	if err != nil {
		return OrganizationInvitation{}, mapStoreError("find invitation", err)
	}
	if account.EmailVerifiedAt == nil || invitation.Email != account.Email ||
		invitation.Status != "pending" || !invitation.ExpiresAt.After(time.Now()) {
		return OrganizationInvitation{}, ErrNotFound
	}

	status := "declined"
	action := "invitation.declined"
	if accept {
		status = "accepted"
		action = "invitation.accepted"
		if _, err := tx.Exec(ctx, `
			INSERT INTO organization_memberships (account_id, organization_id, role, is_default)
			VALUES ($1::uuid, $2::uuid, $3, false)
			ON CONFLICT (account_id, organization_id) DO NOTHING`,
			account.ID, invitation.OrganizationID, invitation.Role); err != nil {
			return OrganizationInvitation{}, mapStoreError("accept invitation membership", err)
		}
	}
	if err := tx.QueryRow(ctx, `
		UPDATE organization_invitations
		SET status = $2, responded_at = now()
		WHERE id = $1::uuid
		RETURNING status, responded_at`, invitation.ID, status,
	).Scan(&invitation.Status, &invitation.RespondedAt); err != nil {
		return OrganizationInvitation{}, mapStoreError("respond invitation", err)
	}

	audit.OrganizationID = invitation.OrganizationID
	audit.Action = action
	audit.ResourceID = invitation.ID
	if err := insertAudit(ctx, tx, audit); err != nil {
		return OrganizationInvitation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return OrganizationInvitation{}, fmt.Errorf("commit respond invitation: %w", err)
	}
	return invitation, nil
}
