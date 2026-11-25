// Package buildinfo derleme sırasında ldflags ile doldurulan sürüm bilgilerini tutar.
package buildinfo

// Version ajan sürümü (semver). Derleme: -ldflags "-X .../buildinfo.Version=1.0.0".
var Version = "1.0.0-dev"

// Commit derlemenin yapıldığı git commit kısa özeti.
var Commit = "unknown"

// BuildDate derleme tarihi (RFC3339).
var BuildDate = "unknown"
