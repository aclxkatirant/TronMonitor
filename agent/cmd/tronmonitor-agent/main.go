// tronmonitor-agent: TronMonitor izleme ajanı komut satırı.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/kardianos/service"

	"github.com/aclxkatirant/TronMonitor/agent/internal/agent"
	"github.com/aclxkatirant/TronMonitor/agent/internal/api"
	"github.com/aclxkatirant/TronMonitor/agent/internal/buildinfo"
	"github.com/aclxkatirant/TronMonitor/agent/internal/config"
	"github.com/aclxkatirant/TronMonitor/agent/internal/logging"
	"github.com/aclxkatirant/TronMonitor/agent/internal/svc"
	"github.com/aclxkatirant/TronMonitor/agent/internal/sysinfo"
)

const usage = `TronMonitor Agent %s

Kullanım:
  tronmonitor-agent <komut> [seçenekler]

Komutlar:
  register   Sunucuyu kayıt belirteciyle merkezi TronMonitor'a kaydeder
  install    Kaydeder (gerekirse), sistem hizmetini kurar ve başlatır
  run        Ajanı ön planda çalıştırır (hizmet tarafından da kullanılır)
  service    Hizmeti yönetir: install | uninstall | start | stop | restart | status
  status     Yapılandırma özetini ve hizmet durumunu gösterir
  uninstall  Hizmeti kaldırır ve yapılandırmayı siler
  version    Sürüm bilgisini yazdırır

Ayrıntılı seçenekler için: tronmonitor-agent <komut> -h
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, usage, buildinfo.Version)
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "register":
		err = cmdRegister(os.Args[2:], false)
	case "install":
		err = cmdRegister(os.Args[2:], true)
	case "run":
		err = cmdRun(os.Args[2:])
	case "service":
		err = cmdService(os.Args[2:])
	case "status":
		err = cmdStatus(os.Args[2:])
	case "uninstall":
		err = cmdUninstall(os.Args[2:])
	case "version", "-v", "--version":
		fmt.Printf("tronmonitor-agent %s (commit %s, %s) %s\n", buildinfo.Version, buildinfo.Commit, buildinfo.BuildDate, sysinfo.OSFamily())
	case "-h", "--help", "help":
		fmt.Printf(usage, buildinfo.Version)
	default:
		fmt.Fprintf(os.Stderr, "Bilinmeyen komut: %s\n\n", os.Args[1])
		fmt.Fprintf(os.Stderr, usage, buildinfo.Version)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "Hata: %v\n", err)
		os.Exit(1)
	}
}

func commonFlags(fs *flag.FlagSet) (cfgPath *string, logLevel *string) {
	cfgPath = fs.String("config", config.DefaultPath(), "yapılandırma dosyası yolu")
	logLevel = fs.String("log-level", "info", "günlük seviyesi: debug | info | warn | error")
	return
}

func cmdRegister(args []string, installService bool) error {
	name := "register"
	if installService {
		name = "install"
	}
	fs := flag.NewFlagSet(name, flag.ExitOnError)
	cfgPath, logLevel := commonFlags(fs)
	serverURL := fs.String("server", "", "merkezi TronMonitor adresi, ör. https://tron.kurum.com")
	token := fs.String("token", "", "panodan alınan kayıt belirteci (tmr_...)")
	caFile := fs.String("ca-file", "", "özel CA sertifikası (PEM) yolu; yalnızca bu CA'ya güvenilir")
	allowHTTP := fs.Bool("allow-http", false, "yalnızca test ortamı: düz HTTP'ye izin ver")
	force := fs.Bool("force", false, "mevcut kaydın üzerine yaz")
	serviceUser := fs.String("service-user", "", "hizmetin çalışacağı hesap (boş: platform varsayılanı)")
	if err := fs.Parse(args); err != nil {
		return err
	}

	if _, err := os.Stat(*cfgPath); err == nil && !*force {
		if !installService {
			return fmt.Errorf("bu sunucu zaten kayıtlı (%s). Yeniden kaydetmek için --force kullanın", *cfgPath)
		}
		fmt.Println("Mevcut kayıt bulundu; yalnızca hizmet kurulacak. Yeniden kaydetmek için --force kullanın.")
	} else {
		if *serverURL == "" || *token == "" {
			return errors.New("--server ve --token zorunludur")
		}
		if err := config.ValidateServerURL(*serverURL, *allowHTTP); err != nil {
			return err
		}
		if !strings.HasPrefix(*token, "tmr_") {
			return errors.New("kayıt belirteci 'tmr_' ile başlamalıdır")
		}
		if err := doRegister(*cfgPath, *serverURL, *token, *caFile, *allowHTTP, *logLevel); err != nil {
			return err
		}
	}

	if !installService {
		fmt.Println("Ajanı hizmet olarak kurmak için: tronmonitor-agent service install")
		return nil
	}
	return installAndStart(*cfgPath, *serviceUser)
}

func doRegister(cfgPath, serverURL, token, caFile string, allowHTTP bool, logLevel string) error {
	client, err := api.New(api.Options{ServerURL: serverURL, CAFile: caFile})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	host := sysinfo.Collect(ctx)
	fmt.Printf("Sunucu bilgisi: %s · %s %s · %s\n", host.Hostname, host.OSName, host.OSVersion, host.Architecture)
	fmt.Printf("Kayıt yapılıyor: %s ...\n", serverURL)

	resp, err := client.Register(ctx, api.RegisterRequest{RegistrationToken: token, AgentVersion: buildinfo.Version, Host: host})
	if err != nil {
		var apiErr *api.APIError
		if errors.As(err, &apiErr) {
			return fmt.Errorf("kayıt reddedildi: %s", apiErr.Message)
		}
		return fmt.Errorf("kayıt başarısız: %w", err)
	}

	cfg := &config.Config{
		ServerURL:             serverURL,
		AgentID:               resp.AgentID,
		ServerID:              resp.ServerID,
		ServerName:            resp.ServerName,
		KeyID:                 resp.KeyID,
		Secret:                resp.Secret,
		CollectionIntervalSec: resp.CollectionIntervalSec,
		HeartbeatIntervalSec:  resp.HeartbeatIntervalSec,
		CAFile:                caFile,
		AllowHTTP:             allowHTTP,
		LogLevel:              logLevel,
	}
	if err := config.Save(cfgPath, cfg); err != nil {
		return err
	}
	fmt.Printf("Kayıt tamamlandı. Sunucu adı: %s\nYapılandırma: %s\n", resp.ServerName, cfgPath)
	return nil
}

func installAndStart(cfgPath, serviceUser string) error {
	log, _ := logging.New(logging.Options{Level: "info", Console: true})
	s, err := svc.New(cfgPath, serviceUser, log)
	if err != nil {
		return err
	}
	if status, err := s.Status(); err == nil && status != service.StatusUnknown {
		fmt.Printf("%s zaten kurulu (%s); yeniden başlatılıyor.\n", svc.Describe(), svc.StatusText(status))
		_ = s.Stop()
		if err := s.Start(); err != nil {
			return fmt.Errorf("hizmet başlatılamadı: %w", err)
		}
		return verifyRunning(s)
	}
	if err := s.Install(); err != nil {
		return fmt.Errorf("hizmet kurulamadı (yönetici/root yetkisi gerekir): %w", err)
	}
	fmt.Printf("%s kuruldu.\n", svc.Describe())
	if err := s.Start(); err != nil {
		return fmt.Errorf("hizmet başlatılamadı: %w", err)
	}
	return verifyRunning(s)
}

func verifyRunning(s service.Service) error {
	time.Sleep(2 * time.Second)
	status, err := s.Status()
	if err != nil {
		return fmt.Errorf("hizmet durumu alınamadı: %w", err)
	}
	if status != service.StatusRunning {
		return fmt.Errorf("hizmet başlatıldı ancak durumu %q; günlükleri denetleyin: %s", svc.StatusText(status), filepath.Join(config.DefaultLogDir(), "agent.log"))
	}
	fmt.Println("Hizmet çalışıyor. Sunucu birkaç saniye içinde panoda görünecek.")
	return nil
}

func cmdRun(args []string) error {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	cfgPath, logLevel := commonFlags(fs)
	if err := fs.Parse(args); err != nil {
		return err
	}
	cfg, err := config.Load(*cfgPath)
	if err != nil {
		return err
	}
	level := cfg.LogLevel
	if *logLevel != "info" {
		level = *logLevel
	}
	interactive := service.Interactive()
	log, logErr := logging.New(logging.Options{FilePath: filepath.Join(config.DefaultLogDir(), "agent.log"), Level: level, Console: interactive})
	if logErr != nil {
		log.Warn("günlük dosyası açılamadı; yalnızca konsola yazılacak", "error", logErr)
	}

	if !interactive {
		// Hizmet yöneticisi altında çalışıyoruz (Windows SCM veya systemd).
		s, err := svc.New(*cfgPath, "", log)
		if err != nil {
			return err
		}
		return s.Run()
	}

	a, err := agent.New(cfg, *cfgPath, log)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	fmt.Println("Ajan ön planda çalışıyor; durdurmak için Ctrl+C.")
	return a.Run(ctx)
}

func cmdService(args []string) error {
	if len(args) < 1 {
		return errors.New("kullanım: tronmonitor-agent service install|uninstall|start|stop|restart|status")
	}
	action := args[0]
	fs := flag.NewFlagSet("service", flag.ExitOnError)
	cfgPath, _ := commonFlags(fs)
	serviceUser := fs.String("service-user", "", "hizmetin çalışacağı hesap (yalnızca install)")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	log, _ := logging.New(logging.Options{Level: "info", Console: true})
	s, err := svc.New(*cfgPath, *serviceUser, log)
	if err != nil {
		return err
	}
	switch action {
	case "install":
		if _, err := config.Load(*cfgPath); err != nil {
			return err
		}
		return installAndStart(*cfgPath, *serviceUser)
	case "uninstall":
		_ = s.Stop()
		if err := s.Uninstall(); err != nil {
			return fmt.Errorf("hizmet kaldırılamadı: %w", err)
		}
		fmt.Printf("%s kaldırıldı.\n", svc.Describe())
		return nil
	case "start":
		if err := s.Start(); err != nil {
			return err
		}
		return verifyRunning(s)
	case "stop":
		if err := s.Stop(); err != nil {
			return err
		}
		fmt.Println("Hizmet durduruldu.")
		return nil
	case "restart":
		if err := s.Restart(); err != nil {
			return err
		}
		return verifyRunning(s)
	case "status":
		status, err := s.Status()
		if err != nil {
			return fmt.Errorf("hizmet durumu alınamadı (kurulu olmayabilir): %w", err)
		}
		fmt.Printf("%s: %s\n", svc.Describe(), svc.StatusText(status))
		return nil
	default:
		return fmt.Errorf("bilinmeyen hizmet eylemi: %s", action)
	}
}

func cmdStatus(args []string) error {
	fs := flag.NewFlagSet("status", flag.ExitOnError)
	cfgPath, _ := commonFlags(fs)
	if err := fs.Parse(args); err != nil {
		return err
	}
	cfg, err := config.Load(*cfgPath)
	if err != nil {
		return err
	}
	summary, _ := json.MarshalIndent(cfg.Redacted(), "", "  ")
	fmt.Printf("Sürüm: %s\nYapılandırma: %s\n%s\n", buildinfo.Version, *cfgPath, summary)
	log, _ := logging.New(logging.Options{Level: "error", Console: true})
	if s, err := svc.New(*cfgPath, "", log); err == nil {
		if status, err := s.Status(); err == nil {
			fmt.Printf("%s: %s\n", svc.Describe(), svc.StatusText(status))
		} else {
			fmt.Printf("%s: kurulu değil\n", svc.Describe())
		}
	}
	return nil
}

func cmdUninstall(args []string) error {
	fs := flag.NewFlagSet("uninstall", flag.ExitOnError)
	cfgPath, _ := commonFlags(fs)
	keepConfig := fs.Bool("keep-config", false, "yapılandırma dosyasını silme")
	if err := fs.Parse(args); err != nil {
		return err
	}
	log, _ := logging.New(logging.Options{Level: "info", Console: true})
	if s, err := svc.New(*cfgPath, "", log); err == nil {
		if _, err := s.Status(); err == nil {
			_ = s.Stop()
			if err := s.Uninstall(); err != nil {
				return fmt.Errorf("hizmet kaldırılamadı: %w", err)
			}
			fmt.Printf("%s kaldırıldı.\n", svc.Describe())
		}
	}
	if !*keepConfig {
		if err := os.Remove(*cfgPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("yapılandırma silinemedi: %w", err)
		}
		fmt.Println("Yapılandırma silindi. Not: Sunucu kaydı panodan ayrıca kaldırılmalıdır.")
	}
	return nil
}
