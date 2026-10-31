// Package captcha 封装阿里云验证码 2.0 服务端验证。
//
// 文件类型：SDK 入口 —— 客户端、配置及验证接口。
// 用途：按服务端预配置的场景验证前端提交的参数。
// 用法：client, err := captcha.NewClient(captcha.WithConfig(cfg))；随后调用 client.Verify。
package captcha

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"time"

	sdk "github.com/alibabacloud-go/captcha-20230305/client"
	openapi "github.com/alibabacloud-go/darabonba-openapi/v2/utils"
	"github.com/alibabacloud-go/tea/dara"
	"github.com/aliyun/credentials-go/credentials"
)

// Kind 表示调用方预先配置的验证场景类型。具体挑战方式由阿里云控制台决定。
type Kind string

const (
	// Traceless 标识无痕验证场景。
	Traceless Kind = "traceless"
	// OneClick 标识一键验证场景。
	OneClick Kind = "one-click"
	// Slider 标识滑块验证场景。
	Slider Kind = "slider"
	// Puzzle 标识拼图验证场景。
	Puzzle Kind = "puzzle"
	// ImageRestore 标识图片还原验证场景。
	ImageRestore Kind = "image-restore"
)

// Config 可由调用方的 TOML、JSON 或 YAML 配置管理器解码。
type Config struct {
	// Endpoint 可选的服务接入点，须与 Region 对应。
	Endpoint string `json:"endpoint" toml:"endpoint" yaml:"endpoint"`
	// Region 为前端地域标识，支持 cn 和 sgp，默认为 cn。
	Region string `json:"region" toml:"region" yaml:"region"`
	// Prefix 为验证码实例标识，必须非空。
	Prefix string `json:"prefix" toml:"prefix" yaml:"prefix"`
	// Scenes 将允许验证的类型映射到控制台创建的场景 ID，至少包含一项。
	Scenes map[Kind]string `json:"scenes" toml:"scenes" yaml:"scenes"`
	// AccessKeyID 与 AccessKeySecret 成对指定访问凭据。
	AccessKeyID string `json:"access_key_id" toml:"access_key_id" yaml:"access_key_id"`
	// AccessKeySecret 为访问密钥，不能单独使用。
	AccessKeySecret string `json:"access_key_secret" toml:"access_key_secret" yaml:"access_key_secret"`
	// SecurityToken 为可选的 STS 令牌，须同时指定访问密钥。
	SecurityToken string `json:"security_token" toml:"security_token" yaml:"security_token"`
	// RoleName 为 ECS 角色名，与访问密钥及令牌互斥。
	RoleName string `json:"role_name" toml:"role_name" yaml:"role_name"`
	// Timeout 供程序设置，零值默认 5 秒，不从配置文件解码。
	Timeout time.Duration `json:"-" toml:"-" yaml:"-"`
	// TimeoutMS 供配置文件设置，单位毫秒；不得与 Timeout 同时设置。
	TimeoutMS int64 `json:"timeout_ms" toml:"timeout_ms" yaml:"timeout_ms"`
}

// FrontendConfig 是可以公开给浏览器的配置，不包含凭据。
type FrontendConfig struct {
	// Region 是与服务端接入点对应的前端地域。
	Region string `json:"region"`
	// Prefix 是可公开的验证码实例标识。
	Prefix string `json:"prefix"`
	// Scenes 是允许使用的场景 ID 副本。
	Scenes map[Kind]string `json:"scenes"`
}

var (
	// ErrConfig 表示配置无效或客户端初始化失败。
	ErrConfig = errors.New("验证码配置无效")
	// ErrInput 表示验证参数或场景类型无效。
	ErrInput = errors.New("验证码请求无效")
	// ErrRejected 表示服务明确拒绝验证。
	ErrRejected = errors.New("验证码验证未通过")
	// ErrService 表示服务响应缺失或顶层状态异常。
	ErrService = errors.New("验证码服务响应异常")
	// ErrTransport 表示服务请求失败，且不包含供应商原始错误。
	ErrTransport = errors.New("验证码服务请求失败")
)

// Caller 是官方 SDK 的上下文验证接口，允许注入客户端或测试替身。
type Caller interface {
	// VerifyIntelligentCaptchaWithContext 发起指定场景的验证请求。
	// 前提：上下文和请求有效；实现应响应上下文取消。
	// 副作用：可发起网络请求；错误：请求或服务调用失败时返回非空错误。
	VerifyIntelligentCaptchaWithContext(context.Context, *sdk.VerifyIntelligentCaptchaRequest, *dara.RuntimeOptions) (*sdk.VerifyIntelligentCaptchaResponse, error)
}
type options struct {
	endpoint   string
	config     Config
	configured bool
	credential credentials.Credential
	client     Caller
}

// Option 配置客户端。
type Option func(*options)

// WithConfig 注入调用方解析后的配置；重复调用时最后一次生效。
func WithConfig(c Config) Option { return func(o *options) { o.config = c; o.configured = true } }

// WithCredential 注入凭据，优先于配置中的完整凭据。
func WithCredential(c credentials.Credential) Option { return func(o *options) { o.credential = c } }

// WithEndpoint 覆盖配置中的服务接入点。
func WithEndpoint(endpoint string) Option { return func(o *options) { o.endpoint = endpoint } }

// WithClient 注入官方客户端或兼容接口，优先于凭据选项。
func WithClient(c Caller) Option { return func(o *options) { o.client = c } }

// Client 验证验证码，并保存一份独立的场景配置。
type Client struct {
	caller   Caller
	frontend FrontendConfig
	timeout  time.Duration
}

// validKind 限定允许选择的场景类型，防止调用方传入任意类型。
func validKind(k Kind) bool {
	switch k {
	case Traceless, OneClick, Slider, Puzzle, ImageRestore:
		return true
	}
	return false
}

// ConfigFromEnv 读取公开配置；凭据由阿里云默认凭据链单独读取。
// 无参数；返回环境配置，超时毫秒数无效时返回 ErrConfig。
func ConfigFromEnv() (Config, error) {
	c := Config{Region: os.Getenv("ALIYUN_CAPTCHA_REGION"), Prefix: os.Getenv("ALIYUN_CAPTCHA_PREFIX"), Endpoint: os.Getenv("ALIYUN_CAPTCHA_ENDPOINT"), Scenes: map[Kind]string{}}
	for k, name := range map[Kind]string{Traceless: "TRACELESS", OneClick: "ONE_CLICK", Slider: "SLIDER", Puzzle: "PUZZLE", ImageRestore: "IMAGE_RESTORE"} {
		if v := os.Getenv("ALIYUN_CAPTCHA_SCENE_" + name); v != "" {
			c.Scenes[k] = v
		}
	}
	if v := os.Getenv("ALIYUN_CAPTCHA_TIMEOUT_MS"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n <= 0 || n > int64((time.Duration(1<<63-1))/time.Millisecond) {
			return Config{}, ErrConfig
		}
		c.TimeoutMS = n
	}
	return c, nil
}

// NewClient 构造客户端；未配置凭据时使用阿里云默认凭据链。
// 参数 opts 指定配置、凭据或底层调用器；未指定 WithConfig 时读取环境配置。
// 返回可用客户端；配置无效或初始化失败时返回 ErrConfig，不包含敏感凭据。
func NewClient(opts ...Option) (*Client, error) {
	o := options{}
	for _, opt := range opts {
		if opt == nil {
			return nil, ErrConfig
		}
		opt(&o)
	}
	c := o.config
	if !o.configured {
		var err error
		c, err = ConfigFromEnv()
		if err != nil {
			return nil, err
		}
	}
	if c.Region == "" {
		c.Region = "cn"
	}
	endpoint := ""
	switch c.Region {
	case "cn":
		endpoint = "captcha.cn-shanghai.aliyuncs.com"
	case "sgp":
		endpoint = "captcha.ap-southeast-1.aliyuncs.com"
	default:
		return nil, ErrConfig
	}
	if c.Endpoint != "" {
		endpoint = c.Endpoint
	}
	if o.endpoint != "" {
		endpoint = o.endpoint
	}
	if (c.Region == "cn" && strings.Contains(endpoint, ".ap-southeast-1.aliyuncs.com")) || (c.Region == "sgp" && strings.Contains(endpoint, ".cn-shanghai.aliyuncs.com")) || strings.ContainsAny(endpoint, "/?# ") {
		return nil, ErrConfig
	}
	if c.Timeout < 0 || c.TimeoutMS < 0 || c.TimeoutMS > int64((time.Duration(1<<63-1))/time.Millisecond) || (c.Timeout != 0 && c.TimeoutMS != 0) {
		return nil, ErrConfig
	}
	if c.TimeoutMS != 0 {
		c.Timeout = time.Duration(c.TimeoutMS) * time.Millisecond
	}
	if c.Timeout == 0 {
		c.Timeout = 5 * time.Second
	}
	if (c.AccessKeyID == "") != (c.AccessKeySecret == "") || (c.SecurityToken != "" && c.AccessKeyID == "") || (c.RoleName != "" && (c.AccessKeyID != "" || c.AccessKeySecret != "" || c.SecurityToken != "")) {
		return nil, ErrConfig
	}
	if strings.TrimSpace(c.Prefix) == "" || len(c.Scenes) == 0 {
		return nil, ErrConfig
	}
	scenes := make(map[Kind]string, len(c.Scenes))
	for k, v := range c.Scenes {
		if !validKind(k) || strings.TrimSpace(v) == "" {
			return nil, ErrConfig
		}
		scenes[k] = v
	}
	caller := o.client
	if caller == nil {
		cred := o.credential
		if cred == nil && c.RoleName != "" {
			var err error
			cred, err = credentials.NewCredential(&credentials.Config{Type: dara.String("ecs_ram_role"), RoleName: dara.String(c.RoleName)})
			if err != nil {
				return nil, ErrConfig
			}
		}
		if cred == nil && c.AccessKeyID != "" {
			typ := "access_key"
			if c.SecurityToken != "" {
				typ = "sts"
			}
			var err error
			cred, err = credentials.NewCredential(&credentials.Config{Type: dara.String(typ), AccessKeyId: dara.String(c.AccessKeyID), AccessKeySecret: dara.String(c.AccessKeySecret), SecurityToken: dara.String(c.SecurityToken)})
			if err != nil {
				return nil, ErrConfig
			}
		}
		if cred == nil {
			var err error
			cred, err = credentials.NewCredential(nil)
			if err != nil {
				return nil, ErrConfig
			}
		}
		var err error
		caller, err = sdk.NewClient(&openapi.Config{Credential: cred, Endpoint: dara.String(endpoint)})
		if err != nil {
			return nil, ErrConfig
		}
	}
	return &Client{caller: caller, frontend: FrontendConfig{Region: c.Region, Prefix: c.Prefix, Scenes: scenes}, timeout: c.Timeout}, nil
}

// FrontendConfig 返回公开配置的独立副本。
// 无参数，返回的场景映射可由调用方修改，不影响客户端。
func (c *Client) FrontendConfig() FrontendConfig {
	out := FrontendConfig{Region: c.frontend.Region, Prefix: c.frontend.Prefix, Scenes: make(map[Kind]string, len(c.frontend.Scenes))}
	for k, v := range c.frontend.Scenes {
		out.Scenes[k] = v
	}
	return out
}

// Verify 原样提交前端参数，并使用服务端预配置的场景 ID。只有明确通过时返回 nil。
// ctx 控制取消和截止时间；kind 选择已配置场景；captchaVerifyParam 为前端原始参数。
// 失败时返回分类错误或上下文错误，不返回验证参数、密钥或供应商原始消息。
func (c *Client) Verify(ctx context.Context, kind Kind, captchaVerifyParam string) error {
	if ctx == nil || strings.TrimSpace(captchaVerifyParam) == "" || !validKind(kind) {
		return ErrInput
	}
	scene, ok := c.frontend.Scenes[kind]
	if !ok {
		return ErrInput
	}
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	resp, err := c.caller.VerifyIntelligentCaptchaWithContext(ctx, &sdk.VerifyIntelligentCaptchaRequest{CaptchaVerifyParam: dara.String(captchaVerifyParam), SceneId: dara.String(scene)}, &dara.RuntimeOptions{})
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return ErrTransport
	}
	if resp == nil || resp.StatusCode == nil || *resp.StatusCode != 200 || resp.Body == nil || resp.Body.Success == nil || !*resp.Body.Success || resp.Body.Code == nil || *resp.Body.Code != "Success" || resp.Body.Result == nil || resp.Body.Result.VerifyResult == nil {
		return ErrService
	}
	if !*resp.Body.Result.VerifyResult {
		return ErrRejected
	}
	return nil
}
