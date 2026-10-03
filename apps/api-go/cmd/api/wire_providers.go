package main

// provider/seed 之外的接线：登录挑战、短信、模型栈、需求门、推送等。

import (
	"context"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/modelstack"
	"github.com/proxy-app/proxy-api/internal/notification"
	"log"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

func configuredLoginChallengeProvider() (identity.LoginChallengeProvider, bool) {
	mode := os.Getenv("PROXY_LOGIN_PROVIDER")
	switch mode {
	case "simulated":
		return identity.NewSimulatedLoginChallengeProvider(os.Getenv("PROXY_SIMULATED_OTP_CODE")), true
	case "smtp":
		// R16.6: fail-fast if smtp mode declared but SMTP env is missing.
		// Without this guard, an operator who exports PROXY_LOGIN_PROVIDER=smtp
		// without sourcing .env ends up with UnconfiguredLoginChallengeProvider
		// — login challenges REJECTED, no email is sent, users see "no OTP
		// arrived" without any boot-time signal. Catch it at boot.
		if os.Getenv("PROXY_SMTP_HOST") == "" {
			log.Fatalf("PROXY_LOGIN_PROVIDER=smtp but PROXY_SMTP_HOST is empty; source .env (PROXY_SMTP_*) before starting the API. Refusing to run with login provider fail-closed.")
		}
		return configuredProductionLoginChallengeProvider(mode)
	case "sms":
		if os.Getenv("PROXY_SMS_URL") == "" {
			log.Fatalf("PROXY_LOGIN_PROVIDER=sms but PROXY_SMS_URL is empty; configure SMS provider before starting the API.")
		}
		return configuredProductionLoginChallengeProvider(mode)
	case "production":
		if os.Getenv("PROXY_SMTP_HOST") == "" && os.Getenv("PROXY_SMS_URL") == "" {
			log.Fatalf("PROXY_LOGIN_PROVIDER=production but neither PROXY_SMTP_HOST nor PROXY_SMS_URL is set; configure one before starting the API.")
		}
		return configuredProductionLoginChallengeProvider(mode)
	// LOGIN-PROVIDER-BOOT-001: this used to silently fall through to
	// UnconfiguredLoginChallengeProvider — every OTP request then rejects
	// with LOGIN_PROVIDER_NOT_CONFIGURED, but nothing at boot time said so
	// loudly. bootenv.Warnings() logs one easy-to-miss line, and its own
	// wording ("PROXY_LOGIN_PROVIDER=\"simulated\" is dev-only") actively
	// implies login still works in a fake-but-functional way — it does not;
	// this is the fail-closed path, not the simulated one. The recurring
	// "验证码服务尚未配置" reports were never a code bug in the login flow
	// itself: PROXY_LOGIN_PROVIDER just wasn't in the process's environment
	// (scripts/dev-api.sh only sources .env "if it exists"; a process
	// started any other way — a bare `go run`, a packaging/deploy step that
	// doesn't carry .env — gets here with mode == ""). The three explicit
	// modes above already refuse to boot on a matching misconfiguration;
	// treat "nothing set at all" the same way instead of the one case that
	// silently degrades.
	case "":
		log.Fatalf("PROXY_LOGIN_PROVIDER is empty; refusing to start with a fail-closed login provider that would reject every OTP request. Set it explicitly: \"simulated\" (dev/QA, PROXY_SIMULATED_OTP_CODE optional), \"smtp\" (+ PROXY_SMTP_HOST), \"sms\" (+ PROXY_SMS_URL), or \"production\" (either). If this is meant to run via scripts/dev-api.sh, confirm .env exists at the repo root and defines PROXY_LOGIN_PROVIDER.")
		return identity.UnconfiguredLoginChallengeProvider{}, false // unreachable; log.Fatalf exits.
	default:
		log.Fatalf("PROXY_LOGIN_PROVIDER=%q is not a recognized mode (want \"simulated\", \"smtp\", \"sms\", or \"production\"); refusing to start with a fail-closed login provider.", mode)
		return identity.UnconfiguredLoginChallengeProvider{}, false // unreachable; log.Fatalf exits.
	}
}

// configuredProductionLoginChallengeProvider wires up the production
// LoginChallengeProvider by reading env. It always returns a non-nil
// provider: if the required env is missing, it returns a fail-closed
// UnconfiguredLoginChallengeProvider and the (provider, simulated) tuple
// is set so /health/ready surfaces the misconfiguration. A mode of
// "production" means: use SMTP if PROXY_SMTP_HOST is set, otherwise SMS
// if PROXY_SMS_URL is set, otherwise fail-closed.
func configuredModelStack() modelstack.Port {
	if strings.EqualFold(os.Getenv("MODELSTACK_USE_PI_CONFIG"), "true") {
		modelsPath := os.Getenv("MODELSTACK_PI_MODELS_PATH")
		settingsPath := os.Getenv("MODELSTACK_PI_SETTINGS_PATH")
		if modelsPath == "" || settingsPath == "" {
			log.Printf("MODELSTACK_USE_PI_CONFIG=true but Pi config paths are missing; model tasks fail-closed")
			return modelstack.Unconfigured{}
		}
		provider, err := modelstack.NewFromPiConfig(modelsPath, settingsPath)
		if err != nil {
			log.Printf("Pi model-stack adapter unavailable: %v", err)
			return modelstack.Unconfigured{}
		}
		log.Printf("model-stack development adapter enabled from Pi provider registry")
		return provider
	}
	controlPlaneURL := os.Getenv("MODELSTACK_CONTROL_PLANE_URL")
	gatewayURL := os.Getenv("MODELSTACK_GATEWAY_URL")
	gatewayAPIKey := os.Getenv("MODELSTACK_GATEWAY_API_KEY")
	if controlPlaneURL == "" || gatewayURL == "" || gatewayAPIKey == "" {
		return modelstack.Unconfigured{}
	}
	return modelstack.New(controlPlaneURL, gatewayURL, gatewayAPIKey)
}

// seedPostgresMedia 幂等写入演示媒体资产（READY，storage key 指向 media_store 现有文件）。
// 固定 ID 供前端种子帖引用（新架构：前端只拿服务端下发的 playbackUrl）。
func localIdentityService(provider identity.LoginChallengeProvider, simulated bool) *identity.Service {
	if !simulated {
		return identity.NewWithRepositoryAndClockAndChallengeProvider(identity.NewMemoryRepository(nil), nil, provider)
	}
	return identity.NewWithRepositoryAndClockAndChallengeProvider(identity.NewMemoryRepository(&identity.Seed{
		User:          identity.UserAccount{ID: "user_001", Status: "ACTIVE"},
		LoginIdentity: identity.LoginIdentity{ID: "login_001", UserAccountID: "user_001", Verified: true, Status: "ACTIVE"},
		Memberships: []identity.Membership{
			{Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_001"}, UserAccountID: "user_001", Status: "ACTIVE"},
			{Principal: command.Principal{Type: "BUSINESS", ID: "business_001"}, UserAccountID: "user_001", Status: "ACTIVE"},
		},
		Devices: []identity.DeviceRegistration{{ID: "device_001", UserAccountID: "user_001", Platform: "IOS", Status: "ACTIVE"}},
	}), nil, provider)
}

func configuredDemandGates() (demand.Gate, demand.Gate) {
	if v := strings.TrimSpace(os.Getenv("PROXY_DEMAND_GATES")); strings.EqualFold(v, "allow") {
		allow := func(*demand.TaskDraft, command.Envelope) demand.GateDecision {
			return demand.GateDecision{Status: "ALLOW"}
		}
		log.Printf("proxy demand gates: ALLOW (PROXY_DEMAND_GATES=allow) — PublishTask will ACCEPT in this environment")
		return allow, allow
	}
	// 真实闸：catalog / funding 校验，正确 payload 下直接 ACCEPT，无需 env
	return demand.CatalogAdmissionGate, demand.FundingGate
}

// configuredNotificationPush 是 notification.PushProviderFromEnv 的一层日志包装。
//
// 判断逻辑搬进 notification 包，是因为 cmd/worker 也需要同一个决定：
// 推送通道是**部署级**的，API 和 worker 各判一次就会出现「一边认为开着、
// 一边认为关着」这种谁都看不见的分叉。worker 现在直接调
// notification.PushProviderFromEnv(os.Getenv, repo)。
//
// tokens 是分发器用来把「收件人」翻译成「哪几台设备」的口。没有它，
// 推送通道就是空壳（这正是改之前的状态）。
//
// 返回 nil 表示**真的关掉**（NOTIFICATION_PUSH=off）。以前
// notification.NewWithPushProvider 会把 nil 兜成 LogPushProvider，
// 所以这个开关从来没生效过。
//
// NOTIF-PUSH-001：现在还会把选择结果**原样记进启动日志**。三档必须能分辨：
// 关掉 / 没配凭据（只记日志）/ 真的会出门推。上一版的日志三种情况长得一样。
func configuredNotificationPush(tokens notification.DeviceTokenLister) notification.PushProvider {
	provider, note := notification.PushProviderFromEnv(os.Getenv, tokens)
	log.Printf("%s", note)
	return provider
}

func wireIdentityEmailResolver(svc *identity.Service) {
	identity.RegisterLoginIdentityEmailResolver(func(loginIdentityID string) (string, bool) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		li, err := svc.Repository().GetLoginIdentity(ctx, loginIdentityID)
		if err != nil {
			return "", false
		}
		if li.Channel != "EMAIL" {
			return "", false
		}
		return li.Identifier, true
	})
}

// parseSMTPPortOrZero is a tolerant wrapper around strconv.Atoi that
// returns 0 on parse failure or empty input. The caller decides what
// 0 means (e.g. fall back to a default port).
func parseSMTPPortOrZero(s string) int {
	if s == "" {
		return 0
	}
	port, err := strconv.Atoi(s)
	if err != nil || port <= 0 {
		return 0
	}
	return port
}

// buildSMSProvider returns the right SMSHTTPLoginChallengeProvider for
// the chosen vendor. The base `cfg` carries the OTP bookkeeping; the
// per-vendor adapter replaces the transport layer so the same generic
// request/response loop works for all of them.
//
// Recognized vendors (PROXY_SMS_PROVIDER):
//
//	"generic"  - bare bearer-token + JSON (the original behavior)
//	"twilio"   - Twilio Programmable SMS (Basic auth, form-encoded)
//	"esms"     - eSMS.vn SendMultipleMessage_V4_get (GET + query params)
//	"speedsms" - SpeedSMS.vn (POST + JSON with access_token)
//
// Anything else (including empty) falls back to "generic".
func buildSMSProvider(vendor string, cfg identity.SMSConfig) *identity.SMSHTTPLoginChallengeProvider {
	switch strings.ToLower(strings.TrimSpace(vendor)) {
	case "twilio":
		sid := os.Getenv("PROXY_SMS_TWILIO_ACCOUNT_SID")
		token := os.Getenv("PROXY_SMS_TWILIO_AUTH_TOKEN")
		from := os.Getenv("PROXY_SMS_TWILIO_FROM")
		if from == "" {
			from = cfg.From
		}
		if sid == "" || token == "" || from == "" {
			log.Printf("PROXY_SMS_PROVIDER=twilio but missing TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM; falling back to generic")
			return identity.NewSMSHTTPLoginChallengeProvider(cfg)
		}
		log.Printf("SMS provider: twilio (AccountSID=%s, From=%s)", sid, from)
		return identity.NewTwilioSMSProvider(cfg, sid, token, from, slog.Default())
	case "esms":
		apiKey := os.Getenv("PROXY_SMS_ESMS_API_KEY")
		secretKey := os.Getenv("PROXY_SMS_ESMS_SECRET_KEY")
		brandname := os.Getenv("PROXY_SMS_ESMS_BRANDNAME")
		smsType := os.Getenv("PROXY_SMS_ESMS_SMS_TYPE")
		if apiKey == "" || secretKey == "" {
			log.Printf("PROXY_SMS_PROVIDER=esms but missing ESMS_API_KEY/SECRET_KEY; falling back to generic")
			return identity.NewSMSHTTPLoginChallengeProvider(cfg)
		}
		log.Printf("SMS provider: esms.vn (brandname=%q, smsType=%s)", brandname, smsType)
		return identity.NewESMSSMSProvider(cfg, apiKey, secretKey, brandname, smsType, slog.Default())
	case "speedsms":
		accessToken := os.Getenv("PROXY_SMS_SPEEDSMS_ACCESS_TOKEN")
		sender := os.Getenv("PROXY_SMS_SPEEDSMS_SENDER")
		if accessToken == "" || sender == "" {
			log.Printf("PROXY_SMS_PROVIDER=speedsms but missing SPEEDSMS_ACCESS_TOKEN/SENDER; falling back to generic")
			return identity.NewSMSHTTPLoginChallengeProvider(cfg)
		}
		log.Printf("SMS provider: speedsms.vn (sender=%s)", sender)
		return identity.NewSpeedSMSSMSProvider(cfg, accessToken, sender, slog.Default())
	default:
		log.Printf("SMS provider: generic bearer-token webhook")
		return identity.NewSMSHTTPLoginChallengeProvider(cfg)
	}
}

// jurisdictionAdapter bridges the wire layer's
// *jurisdiction.Service to the fulfillment package's
// one-method jurisdictionResolver interface. The
// fulfillment package does not import the jurisdiction
// package directly (one-way dependency).

func configuredProductionLoginChallengeProvider(mode string) (identity.LoginChallengeProvider, bool) {
	host := os.Getenv("PROXY_SMTP_HOST")
	url := os.Getenv("PROXY_SMS_URL")
	var smtpProvider *identity.SMTPLoginChallengeProvider
	var smsProvider *identity.SMSHTTPLoginChallengeProvider
	if (mode == "smtp" || mode == "production") && host != "" {
		portStr := os.Getenv("PROXY_SMTP_PORT")
		port, err := strconv.Atoi(portStr)
		if err != nil || port <= 0 {
			log.Printf("PROXY_SMTP_PORT invalid (%q); smtp provider disabled", portStr)
		} else {
			smtpProvider = identity.NewSMTPLoginChallengeProvider(identity.SMTPConfig{
				Host:     host,
				Port:     port,
				Username: os.Getenv("PROXY_SMTP_USERNAME"),
				Password: os.Getenv("PROXY_SMTP_PASSWORD"),
				From:     os.Getenv("PROXY_SMTP_FROM"),
				TLSMode:  os.Getenv("PROXY_SMTP_TLS"),
				Logger:   slog.Default(),
			})
			if !smtpProvider.Configured() {
				log.Printf("SMTP provider disabled: PROXY_SMTP_HOST, PROXY_SMTP_PORT and PROXY_SMTP_FROM must all be valid")
				smtpProvider = nil
			}
		}
	}

	// Per-domain SMTP routes (R15.28): allow Gmail/QQ/163/126 etc. to be
	// served by their local SMTP backends so mainland-China users (where
	// Gmail is blocked) still receive OTP mail. If no routes are
	// configured, fall through to the single `smtpProvider` above.
	var smtpMultiProvider *identity.SMTPMultiProvider
	if mode == "smtp" || mode == "production" {
		routeDomains := os.Getenv("PROXY_SMTP_ROUTE_DOMAINS")
		if routeDomains != "" {
			var defaultCfg identity.SMTPConfig
			if smtpProvider != nil {
				defaultCfg = identity.SMTPConfig{
					Host: host, Port: parseSMTPPortOrZero(os.Getenv("PROXY_SMTP_PORT")),
					Username: os.Getenv("PROXY_SMTP_USERNAME"),
					Password: os.Getenv("PROXY_SMTP_PASSWORD"),
					From:     os.Getenv("PROXY_SMTP_FROM"),
					TLSMode:  os.Getenv("PROXY_SMTP_TLS"),
					Logger:   slog.Default(),
				}
			}
			var routes []identity.SMTPMultiRoute
			for _, dom := range strings.Split(routeDomains, ",") {
				dom = strings.TrimSpace(dom)
				if dom == "" {
					continue
				}
				// env-var naming rule: dots in the domain are converted
				// to underscores so the variable is a legal shell
				// identifier (e.g. gmail.com -> GMAIL_COM).
				prefix := "PROXY_SMTP_ROUTE_" + strings.ReplaceAll(strings.ToUpper(dom), ".", "_") + "_"
				host := os.Getenv(prefix + "HOST")
				if host == "" {
					log.Printf("SMTP-ROUTES-DEBUG: no host env for domain %q (looked for %s)", dom, prefix+"HOST")
					continue
				}
				port := parseSMTPPortOrZero(os.Getenv(prefix + "PORT"))
				if port == 0 {
					port = 587
				}
				routes = append(routes, identity.SMTPMultiRoute{
					Domain: dom,
					Cfg: identity.SMTPConfig{
						Host:     host,
						Port:     port,
						Username: os.Getenv(prefix + "USERNAME"),
						Password: os.Getenv(prefix + "PASSWORD"),
						From:     os.Getenv(prefix + "FROM"),
						TLSMode:  os.Getenv(prefix + "TLS"),
						Logger:   slog.Default(),
					},
				})
			}
			if len(routes) > 0 {
				smtpMultiProvider = identity.NewSMTPMultiProvider(defaultCfg, routes, slog.Default())
				if !smtpMultiProvider.Configured() {
					log.Printf("SMTP route provider disabled: no route has HOST, PORT and FROM configured")
					smtpMultiProvider = nil
				}
			}
		}
	}
	if (mode == "sms" || mode == "production") && url != "" {
		smsProvider = buildSMSProvider(os.Getenv("PROXY_SMS_PROVIDER"), identity.SMSConfig{
			URL:    url,
			From:   os.Getenv("PROXY_SMS_FROM"),
			Token:  os.Getenv("PROXY_SMS_TOKEN"),
			Logger: slog.Default(),
		})
	}
	// Dev-only smoke resolvers: when PROXY_SMTP_TEST_RECIPIENT is set we
	// hand every EMAIL LoginChallengeRequest a fixed recipient instead of
	// looking the LoginIdentity up in storage. The production path
	// (LoginIdentityID → identifier via PG) is wired in main() via
	// wireIdentityEmailResolver(identityService) after the PG repo is open.
	if smtpProvider != nil {
		if testRecipient := os.Getenv("PROXY_SMTP_TEST_RECIPIENT"); testRecipient != "" {
			identity.RegisterLoginIdentityEmailResolver(func(string) (string, bool) {
				return testRecipient, true
			})
		}
	}
	if smsProvider != nil {
		if testPhone := os.Getenv("PROXY_SMS_TEST_PHONE"); testPhone != "" {
			identity.RegisterLoginIdentityPhoneResolver(func(string) (string, bool) {
				return testPhone, true
			})
		}
	}
	// mode == "production" with no concrete env produces a router with
	// no concrete providers; that is intentionally fail-closed. mode
	// "smtp" / "sms" with the required env set produces a router with
	// one real provider.
	var emailProvider identity.LoginChallengeProvider
	switch {
	case smtpMultiProvider != nil:
		emailProvider = smtpMultiProvider
	case smtpProvider != nil:
		emailProvider = smtpProvider
	}
	var smsProviderIface identity.LoginChallengeProvider
	if smsProvider != nil {
		smsProviderIface = smsProvider
	}
	router := identity.NewChannelRouter(emailProvider, smsProviderIface)
	if smtpProvider == nil && smsProvider == nil && smtpMultiProvider == nil {
		// LOGIN-PROVIDER-BOOT-001: the caller already required PROXY_SMTP_HOST
		// or PROXY_SMS_URL to be non-empty for this mode — reaching here with
		// no provider actually constructed means the declared config still
		// didn't produce a working wiring (not "operator forgot .env", but
		// "operator's .env doesn't do what they think it does"). That is a
		// worse surprise than the plain missing-env case, so it gets the same
		// fail-loud treatment instead of a Printf nobody reads at 3am.
		log.Fatalf("PROXY_LOGIN_PROVIDER=%s declared SMTP/SMS env but no provider was actually constructed; login provider would be fail-closed. Check PROXY_SMTP_*/PROXY_SMS_* for a value that failed validation.", mode)
	}
	routesActive := 0
	if smtpMultiProvider != nil {
		domains := strings.Split(os.Getenv("PROXY_SMTP_ROUTE_DOMAINS"), ",")
		for _, d := range domains {
			if strings.TrimSpace(d) != "" {
				routesActive++
			}
		}
	}
	log.Printf("PROXY_LOGIN_PROVIDER=%s: smtp=%v smtp_routes=%d sms=%v", mode, smtpProvider != nil, routesActive, smsProvider != nil)
	return router, false
}

// configuredModelStack 装配公共模型底座适配器。业务侧契约：只发任务 ID，
// 模型选择/Provider/凭证/failover 全部由底座负责。任一配置缺失时返回
// fail-closed 的 Unconfigured 适配器，Domain 能力视为不可用。
