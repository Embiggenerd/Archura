package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"time"
)

type cloudflareEmailDelivery struct {
	apiToken string
	from     string
	endpoint string
	client   *http.Client
}

func newCloudflareEmailDelivery(accountID, apiToken, from string) *cloudflareEmailDelivery {
	return &cloudflareEmailDelivery{
		apiToken: apiToken, from: from,
		endpoint: fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/email/sending/send", accountID),
		client:   &http.Client{Timeout: 10 * time.Second},
	}
}

func (d *cloudflareEmailDelivery) deliverConfirmation(ctx context.Context, entry pendingConfirmation) error {
	subject := "Confirm your Archura email"
	textBody := "Confirm your email and continue to Archura: " + entry.ConfirmURL
	htmlBody := `<p>Confirm your email and continue to Archura:</p><p><a href="` + html.EscapeString(entry.ConfirmURL) + `">Confirm email</a></p>`
	return d.send(ctx, entry.Email, subject, textBody, htmlBody)
}

func (d *cloudflareEmailDelivery) deliverInvitation(ctx context.Context, entry pendingInvitationEmail) error {
	organization := entry.OrganizationName
	if organization == "" {
		organization = "an Archura organization"
	}
	subject := "You were invited to " + organization
	textBody := "You were invited to join " + organization + ". Sign in with this email to accept: " + entry.AccountURL
	htmlBody := `<p>You were invited to join ` + html.EscapeString(organization) + `.</p><p><a href="` + html.EscapeString(entry.AccountURL) + `">View invitation</a></p>`
	return d.send(ctx, entry.Email, subject, textBody, htmlBody)
}

func (d *cloudflareEmailDelivery) consumed(string) {}

func (d *cloudflareEmailDelivery) send(ctx context.Context, to, subject, textBody, htmlBody string) error {
	body, err := json.Marshal(map[string]any{
		"to":      to,
		"from":    map[string]string{"address": d.from, "name": "Archura"},
		"subject": subject,
		"text":    textBody,
		"html":    htmlBody,
	})
	if err != nil {
		return fmt.Errorf("encode transactional email: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create transactional email request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+d.apiToken)
	req.Header.Set("Content-Type", "application/json")
	response, err := d.client.Do(req)
	if err != nil {
		return fmt.Errorf("send transactional email: %w", err)
	}
	defer response.Body.Close()
	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if readErr != nil {
		return fmt.Errorf("read transactional email response: %w", readErr)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("transactional email rejected with status %d: %s", response.StatusCode, string(responseBody))
	}
	return nil
}
