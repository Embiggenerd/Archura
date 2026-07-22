package main

import "testing"

func TestValidEnvironment(t *testing.T) {
	for _, env := range []string{"dev", "staging", "prod"} {
		if !validEnvironment(env) {
			t.Fatalf("validEnvironment(%q) = false", env)
		}
	}
	for _, env := range []string{"", "production", "stage"} {
		if validEnvironment(env) {
			t.Fatalf("validEnvironment(%q) = true", env)
		}
	}
}
