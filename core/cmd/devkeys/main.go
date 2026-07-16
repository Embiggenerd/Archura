// Command devkeys generates local development credentials.
package main

import (
	"fmt"
	"os"

	archauth "github.com/archura/core/internal/auth"
)

func main() {
	kind := "admin"
	if len(os.Args) > 1 {
		kind = os.Args[1]
	}

	prefix := "adm"
	label := "PLATFORM_ADMIN_KEY"
	switch kind {
	case "admin":
	case "publishable":
		prefix = "pk"
		label = "PUBLISHABLE_KEY"
	case "service":
		prefix = "svc"
		label = "CORE_SERVICE_KEY"
	default:
		fmt.Fprintln(os.Stderr, "usage: go run ./cmd/devkeys [admin|publishable|service]")
		os.Exit(2)
	}

	key, err := archauth.Generate(prefix, "dev")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("%s=%s\n", label, key)
}
