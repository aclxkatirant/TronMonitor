//go:build !windows && !linux

package services

import "context"

func list(_ context.Context) ([]Service, error) { return nil, ErrUnsupported }

func control(_ context.Context, _ string, _ Action) error { return ErrUnsupported }
