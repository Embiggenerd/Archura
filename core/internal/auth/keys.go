// Package auth creates and verifies Archura API credentials.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
)

const randomBytes = 32

func Generate(kind, env string) (string, error) {
	prefix, err := prefixFor(kind, env)
	if err != nil {
		return "", err
	}

	raw := make([]byte, randomBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate %s key: %w", kind, err)
	}
	return prefix + base64.RawURLEncoding.EncodeToString(raw), nil
}

func Hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func Equal(left, right string) bool {
	leftHash := sha256.Sum256([]byte(left))
	rightHash := sha256.Sum256([]byte(right))
	return subtle.ConstantTimeCompare(leftHash[:], rightHash[:]) == 1
}

func HasKind(value, kind string) bool {
	return strings.HasPrefix(value, kind+"_test_") || strings.HasPrefix(value, kind+"_live_")
}

func prefixFor(kind, env string) (string, error) {
	switch kind {
	case "adm", "pk", "sk", "ct", "cmp", "ses", "svc", "cfm", "sess":
	default:
		return "", fmt.Errorf("unsupported key kind %q", kind)
	}
	mode := "test"
	if env == "prod" {
		mode = "live"
	}
	return kind + "_" + mode + "_", nil
}

func HasKindForEnv(value, kind, env string) bool {
	prefix, err := prefixFor(kind, env)
	return err == nil && strings.HasPrefix(value, prefix)
}
