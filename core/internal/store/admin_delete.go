package store

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

type lockedAdminOrganization struct {
	ID                  string
	Slug                string
	IsPlatformWorkspace bool
	SubscriptionID      string
	SubscriptionStatus  string
}

func (s *Store) AdminAccounts(ctx context.Context, query string, limit, offset int) (AdminPage[AdminAccount], error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT a.id::text, a.email, COALESCE(a.staff_role, ''), a.created_at,
			(SELECT count(*) FROM organization_memberships m WHERE m.account_id = a.id)
		FROM accounts a
		WHERE $1 = '' OR a.id::text = $1 OR a.email ILIKE '%' || $1 || '%'
		ORDER BY a.created_at DESC, a.id
		LIMIT $2 OFFSET $3`, strings.TrimSpace(query), limit+1, offset)
	if err != nil {
		return AdminPage[AdminAccount]{}, fmt.Errorf("list admin accounts: %w", err)
	}
	defer rows.Close()
	items := make([]AdminAccount, 0, limit+1)
	for rows.Next() {
		var item AdminAccount
		if err := rows.Scan(&item.ID, &item.Email, &item.StaffRole, &item.CreatedAt, &item.MembershipCount); err != nil {
			return AdminPage[AdminAccount]{}, fmt.Errorf("scan admin account: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return AdminPage[AdminAccount]{}, fmt.Errorf("iterate admin accounts: %w", err)
	}
	page := AdminPage[AdminAccount]{Items: items}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		page.NextCursor = fmt.Sprintf("%d", offset+limit)
	}
	return page, nil
}

func (s *Store) AdminAccountByID(ctx context.Context, accountID string) (AdminAccountDetail, error) {
	var detail AdminAccountDetail
	err := s.Pool.QueryRow(ctx, `
		SELECT id::text, email, COALESCE(staff_role, ''), created_at,
			(SELECT count(*) FROM organization_memberships WHERE account_id = accounts.id)
		FROM accounts WHERE id::text = $1`, accountID).Scan(
		&detail.ID, &detail.Email, &detail.StaffRole, &detail.CreatedAt, &detail.MembershipCount,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return AdminAccountDetail{}, ErrNotFound
	}
	if err != nil {
		return AdminAccountDetail{}, fmt.Errorf("get admin account: %w", err)
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT o.id::text, o.slug, m.role,
			(SELECT count(*) FROM organization_memberships all_m WHERE all_m.organization_id = o.id),
			(SELECT count(*) FROM organization_memberships owners WHERE owners.organization_id = o.id AND owners.role = 'owner'),
			ARRAY(SELECT sites.subdomain FROM organization_sites sites WHERE sites.organization_id = o.id ORDER BY sites.subdomain)
		FROM organization_memberships m
		JOIN organizations o ON o.id = m.organization_id
		WHERE m.account_id::text = $1
		ORDER BY o.id`, accountID)
	if err != nil {
		return AdminAccountDetail{}, fmt.Errorf("list admin account memberships: %w", err)
	}
	defer rows.Close()
	detail.Memberships = make([]AdminAccountMembership, 0)
	for rows.Next() {
		var membership AdminAccountMembership
		var ownerCount int
		if err := rows.Scan(
			&membership.OrganizationID, &membership.Slug, &membership.Role,
			&membership.MemberCount, &ownerCount, &membership.Sites,
		); err != nil {
			return AdminAccountDetail{}, fmt.Errorf("scan admin account membership: %w", err)
		}
		membership.SoleMember = membership.MemberCount == 1
		membership.LastOwner = membership.Role == "owner" && ownerCount == 1 && membership.MemberCount > 1
		detail.Memberships = append(detail.Memberships, membership)
	}
	if err := rows.Err(); err != nil {
		return AdminAccountDetail{}, fmt.Errorf("iterate admin account memberships: %w", err)
	}
	return detail, nil
}

func (s *Store) DeleteOrganization(
	ctx context.Context,
	organizationID string,
	audit AuditEvent,
) (AdminOrganizationDeleteResult, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return AdminOrganizationDeleteResult{}, fmt.Errorf("begin admin organization delete: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	organization, err := lockAdminOrganization(ctx, tx, organizationID)
	if err != nil {
		return AdminOrganizationDeleteResult{}, err
	}
	if err := guardAdminOrganizationDelete(organization); err != nil {
		return AdminOrganizationDeleteResult{}, err
	}
	sites, err := deleteLockedAdminOrganization(ctx, tx, organization, audit)
	if err != nil {
		return AdminOrganizationDeleteResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AdminOrganizationDeleteResult{}, fmt.Errorf("commit admin organization delete: %w", err)
	}
	return AdminOrganizationDeleteResult{ReleasedSites: sites}, nil
}

func (s *Store) DeleteAccount(
	ctx context.Context,
	accountID string,
	audit AuditEvent,
) (AdminAccountDeleteResult, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return AdminAccountDeleteResult{}, fmt.Errorf("begin admin account delete: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var email string
	err = tx.QueryRow(ctx, `SELECT email FROM accounts WHERE id::text = $1`, accountID).Scan(&email)
	if errors.Is(err, pgx.ErrNoRows) {
		return AdminAccountDeleteResult{}, ErrNotFound
	}
	if err != nil {
		return AdminAccountDeleteResult{}, fmt.Errorf("find account before delete: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM organization_invitations WHERE email = $1 AND status = 'pending'`, email); err != nil {
		return AdminAccountDeleteResult{}, fmt.Errorf("delete pending account invitations: %w", err)
	}

	var staffRole string
	err = tx.QueryRow(ctx, `
		SELECT email, COALESCE(staff_role, '') FROM accounts WHERE id::text = $1 FOR UPDATE`, accountID,
	).Scan(&email, &staffRole)
	if errors.Is(err, pgx.ErrNoRows) {
		return AdminAccountDeleteResult{}, ErrNotFound
	}
	if err != nil {
		return AdminAccountDeleteResult{}, fmt.Errorf("lock account for delete: %w", err)
	}
	if staffRole != "" {
		return AdminAccountDeleteResult{}, &AdminDeleteBlocked{Code: "staff_account"}
	}

	rows, err := tx.Query(ctx, `
		SELECT organization_id::text FROM organization_memberships
		WHERE account_id::text = $1 ORDER BY organization_id`, accountID)
	if err != nil {
		return AdminAccountDeleteResult{}, fmt.Errorf("list account organizations for delete: %w", err)
	}
	organizationIDs := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return AdminAccountDeleteResult{}, fmt.Errorf("scan account organization for delete: %w", err)
		}
		organizationIDs = append(organizationIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return AdminAccountDeleteResult{}, fmt.Errorf("iterate account organizations for delete: %w", err)
	}
	rows.Close()

	locked := make([]lockedAdminOrganization, 0, len(organizationIDs))
	for _, id := range organizationIDs {
		organization, err := lockAdminOrganization(ctx, tx, id)
		if errors.Is(err, ErrNotFound) {
			continue
		}
		if err != nil {
			return AdminAccountDeleteResult{}, err
		}
		locked = append(locked, organization)
	}

	toDelete := make([]lockedAdminOrganization, 0)
	for _, organization := range locked {
		var role string
		var memberCount, ownerCount int
		err := tx.QueryRow(ctx, `
			SELECT target.role,
				(SELECT count(*) FROM organization_memberships WHERE organization_id = $2::uuid),
				(SELECT count(*) FROM organization_memberships WHERE organization_id = $2::uuid AND role = 'owner')
			FROM organization_memberships target
			WHERE target.account_id = $1::uuid AND target.organization_id = $2::uuid`,
			accountID, organization.ID,
		).Scan(&role, &memberCount, &ownerCount)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return AdminAccountDeleteResult{}, fmt.Errorf("classify account organization delete: %w", err)
		}
		if memberCount == 1 {
			if err := guardAdminOrganizationDelete(organization); err != nil {
				return AdminAccountDeleteResult{}, err
			}
			toDelete = append(toDelete, organization)
			continue
		}
		if role == "owner" && ownerCount == 1 {
			return AdminAccountDeleteResult{}, &AdminDeleteBlocked{
				Code: "last_owner", OrganizationID: organization.ID, OrganizationSlug: organization.Slug,
			}
		}
	}

	result := AdminAccountDeleteResult{
		DeletedOrganizationIDs: make([]string, 0, len(toDelete)),
		ReleasedSites:          make([]string, 0),
	}
	for _, organization := range toDelete {
		sites, err := deleteLockedAdminOrganization(ctx, tx, organization, audit)
		if err != nil {
			return AdminAccountDeleteResult{}, err
		}
		result.DeletedOrganizationIDs = append(result.DeletedOrganizationIDs, organization.ID)
		result.ReleasedSites = append(result.ReleasedSites, sites...)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM email_confirmations WHERE email = $1`, email); err != nil {
		return AdminAccountDeleteResult{}, fmt.Errorf("delete account confirmations: %w", err)
	}
	deleteResult, err := tx.Exec(ctx, `DELETE FROM accounts WHERE id::text = $1`, accountID)
	if err != nil {
		return AdminAccountDeleteResult{}, fmt.Errorf("delete account: %w", err)
	}
	if deleteResult.RowsAffected() != 1 {
		return AdminAccountDeleteResult{}, ErrNotFound
	}
	accountAudit := audit
	accountAudit.OrganizationID = ""
	accountAudit.Action = "admin.account_deleted"
	accountAudit.ResourceType = "account"
	accountAudit.ResourceID = accountID
	accountAudit.Metadata = DeletionAuditMetadata{
		Email: email, DeletedOrganizationIDs: result.DeletedOrganizationIDs,
	}
	if err := insertAudit(ctx, tx, accountAudit); err != nil {
		return AdminAccountDeleteResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AdminAccountDeleteResult{}, fmt.Errorf("commit admin account delete: %w", err)
	}
	return result, nil
}

func lockAdminOrganization(ctx context.Context, tx pgx.Tx, organizationID string) (lockedAdminOrganization, error) {
	organization := lockedAdminOrganization{ID: organizationID}
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(stripe_subscription_id, ''), COALESCE(stripe_subscription_status, '')
		FROM organization_billing WHERE organization_id::text = $1 FOR UPDATE`, organizationID,
	).Scan(&organization.SubscriptionID, &organization.SubscriptionStatus)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return lockedAdminOrganization{}, fmt.Errorf("lock organization billing for delete: %w", err)
	}
	err = tx.QueryRow(ctx, `
		SELECT id::text, slug, is_platform_workspace FROM organizations WHERE id::text = $1 FOR UPDATE`, organizationID,
	).Scan(&organization.ID, &organization.Slug, &organization.IsPlatformWorkspace)
	if errors.Is(err, pgx.ErrNoRows) {
		return lockedAdminOrganization{}, ErrNotFound
	}
	if err != nil {
		return lockedAdminOrganization{}, fmt.Errorf("lock organization for delete: %w", err)
	}
	return organization, nil
}

func guardAdminOrganizationDelete(organization lockedAdminOrganization) error {
	if organization.IsPlatformWorkspace || organization.Slug == PlatformWorkspaceSlug {
		return &AdminDeleteBlocked{
			Code: "platform_workspace", OrganizationID: organization.ID, OrganizationSlug: organization.Slug,
		}
	}
	if organization.SubscriptionID != "" && organization.SubscriptionStatus != "canceled" {
		return &AdminDeleteBlocked{
			Code: "subscription_active", OrganizationID: organization.ID, OrganizationSlug: organization.Slug,
		}
	}
	return nil
}

func deleteLockedAdminOrganization(
	ctx context.Context,
	tx pgx.Tx,
	organization lockedAdminOrganization,
	audit AuditEvent,
) ([]string, error) {
	rows, err := tx.Query(ctx, `
		SELECT subdomain FROM organization_sites WHERE organization_id = $1::uuid ORDER BY subdomain`, organization.ID)
	if err != nil {
		return nil, fmt.Errorf("list organization sites for delete: %w", err)
	}
	sites := make([]string, 0)
	for rows.Next() {
		var subdomain string
		if err := rows.Scan(&subdomain); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan organization site for delete: %w", err)
		}
		sites = append(sites, subdomain)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate organization sites for delete: %w", err)
	}
	rows.Close()
	if _, err := tx.Exec(ctx, `UPDATE audit_log SET organization_id = NULL WHERE organization_id = $1::uuid`, organization.ID); err != nil {
		return nil, fmt.Errorf("detach organization audit history: %w", err)
	}
	result, err := tx.Exec(ctx, `DELETE FROM organizations WHERE id = $1::uuid`, organization.ID)
	if err != nil {
		return nil, fmt.Errorf("delete organization: %w", err)
	}
	if result.RowsAffected() != 1 {
		return nil, ErrNotFound
	}
	organizationAudit := audit
	organizationAudit.OrganizationID = ""
	organizationAudit.Action = "admin.organization_deleted"
	organizationAudit.ResourceType = "organization"
	organizationAudit.ResourceID = organization.ID
	organizationAudit.Metadata = DeletionAuditMetadata{Slug: organization.Slug}
	if err := insertAudit(ctx, tx, organizationAudit); err != nil {
		return nil, err
	}
	return sites, nil
}

func (s *Store) OrganizationExists(ctx context.Context, organizationID string) (bool, error) {
	var exists bool
	if err := s.Pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM organizations WHERE id::text = $1)`, organizationID,
	).Scan(&exists); err != nil {
		return false, fmt.Errorf("check organization existence: %w", err)
	}
	return exists, nil
}

func (s *Store) SiteBinding(ctx context.Context, subdomain string) (string, bool, error) {
	var organizationID string
	err := s.Pool.QueryRow(ctx, `
		SELECT organization_id::text FROM organization_sites WHERE subdomain = $1`, subdomain,
	).Scan(&organizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("get site binding: %w", err)
	}
	return organizationID, true, nil
}
