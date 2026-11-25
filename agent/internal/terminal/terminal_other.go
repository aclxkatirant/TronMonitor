//go:build !windows && !linux

package terminal

func start(cols, rows int) (Shell, error) {
	return nil, ErrUnsupported
}
