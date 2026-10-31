// 本文件为验证码客户端的隔离测试。
// 文件类型：单元及本地传输测试；用途：验证配置、响应判定与取消行为。
// 用法：执行 go test ./captcha，不请求真实阿里云服务。
package captcha

import (
	"context"
	"encoding/json"
	"errors"
	sdk "github.com/alibabacloud-go/captcha-20230305/client"
	openapi "github.com/alibabacloud-go/darabonba-openapi/v2/utils"
	"github.com/alibabacloud-go/tea/dara"
	"github.com/aliyun/credentials-go/credentials"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fake func(context.Context, *sdk.VerifyIntelligentCaptchaRequest, *dara.RuntimeOptions) (*sdk.VerifyIntelligentCaptchaResponse, error)

// VerifyIntelligentCaptchaWithContext 将调用转交给测试替身。
func (f fake) VerifyIntelligentCaptchaWithContext(c context.Context, r *sdk.VerifyIntelligentCaptchaRequest, o *dara.RuntimeOptions) (*sdk.VerifyIntelligentCaptchaResponse, error) {
	return f(c, r, o)
}

// cfg 提供无需真实凭据的测试场景配置。
func cfg() Config { return Config{Prefix: "prefix", Scenes: map[Kind]string{Slider: "scene"}} }

// response 构造明确通过或拒绝的服务响应。
func response(ok bool) *sdk.VerifyIntelligentCaptchaResponse {
	return &sdk.VerifyIntelligentCaptchaResponse{StatusCode: dara.Int32(200), Body: &sdk.VerifyIntelligentCaptchaResponseBody{Code: dara.String("Success"), Success: dara.Bool(true), Result: &sdk.VerifyIntelligentCaptchaResponseBodyResult{VerifyResult: dara.Bool(ok)}}}
}

// TestVerify 检查响应分类及参数原样传递。
func TestVerify(t *testing.T) {
	for _, tc := range []struct {
		name           string
		resp           *sdk.VerifyIntelligentCaptchaResponse
		err, errorWant error
	}{
		{"通过", response(true), nil, nil}, {"拒绝", response(false), nil, ErrRejected}, {"空响应", nil, nil, ErrService}, {"空结果", &sdk.VerifyIntelligentCaptchaResponse{StatusCode: dara.Int32(200)}, nil, ErrService}, {"错误状态", func() *sdk.VerifyIntelligentCaptchaResponse {
			x := response(true)
			x.StatusCode = dara.Int32(500)
			return x
		}(), nil, ErrService}, {"成功标志缺失", func() *sdk.VerifyIntelligentCaptchaResponse { x := response(true); x.Body.Success = nil; return x }(), nil, ErrService}, {"结果缺失", func() *sdk.VerifyIntelligentCaptchaResponse {
			x := response(true)
			x.Body.Result.VerifyResult = nil
			return x
		}(), nil, ErrService}, {"传输", nil, errors.New("secret token"), ErrTransport},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client, e := NewClient(WithConfig(cfg()), WithClient(fake(func(_ context.Context, r *sdk.VerifyIntelligentCaptchaRequest, _ *dara.RuntimeOptions) (*sdk.VerifyIntelligentCaptchaResponse, error) {
				if *r.SceneId != "scene" || *r.CaptchaVerifyParam != " token " {
					t.Fatal("参数被改变")
				}
				return tc.resp, tc.err
			})))
			if e != nil {
				t.Fatal(e)
			}
			if e = client.Verify(context.Background(), Slider, " token "); !errors.Is(e, tc.errorWant) {
				t.Fatalf("错误：%v", e)
			}
		})
	}
}

// TestCancelAndTimeout 检查调用器收到取消及超时。
func TestCancelAndTimeout(t *testing.T) {
	f := fake(func(ctx context.Context, _ *sdk.VerifyIntelligentCaptchaRequest, _ *dara.RuntimeOptions) (*sdk.VerifyIntelligentCaptchaResponse, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	})
	c := cfg()
	c.Timeout = 10 * time.Millisecond
	client, e := NewClient(WithConfig(c), WithClient(f))
	if e != nil {
		t.Fatal(e)
	}
	if e = client.Verify(context.Background(), Slider, "token"); !errors.Is(e, context.DeadlineExceeded) {
		t.Fatal(e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if e = client.Verify(ctx, Slider, "token"); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
}

// TestConfig 检查配置约束及公开配置副本。
func TestConfig(t *testing.T) {
	f := fake(func(context.Context, *sdk.VerifyIntelligentCaptchaRequest, *dara.RuntimeOptions) (*sdk.VerifyIntelligentCaptchaResponse, error) {
		return response(true), nil
	})
	for _, change := range []func(*Config){func(c *Config) { c.AccessKeyID = "id" }, func(c *Config) { c.SecurityToken = "token" }, func(c *Config) { c.AccessKeyID = "id"; c.AccessKeySecret = "secret"; c.RoleName = "role" }, func(c *Config) { c.Region = "bad" }, func(c *Config) { c.Scenes["bad"] = "x" }} {
		c := cfg()
		change(&c)
		if _, e := NewClient(WithConfig(c), WithClient(f)); !errors.Is(e, ErrConfig) {
			t.Fatal(e)
		}
	}
	c := cfg()
	c.AccessKeyID = "id"
	c.AccessKeySecret = "secret"
	client, e := NewClient(WithConfig(c), WithClient(f))
	if e != nil {
		t.Fatal(e)
	}
	c.Scenes[Slider] = "changed"
	pub := client.FrontendConfig()
	pub.Scenes[Slider] = "modified"
	b, _ := json.Marshal(client.FrontendConfig())
	if strings.Contains(string(b), "secret") || strings.Contains(string(b), "changed") || strings.Contains(string(b), "modified") {
		t.Fatal(string(b))
	}
	if e = client.Verify(context.Background(), Puzzle, "token"); !errors.Is(e, ErrInput) {
		t.Fatal(e)
	}
}

// TestEnvConfig 检查环境配置及显式配置优先级。
func TestEnvConfig(t *testing.T) {
	t.Setenv("ALIYUN_CAPTCHA_REGION", "sgp")
	t.Setenv("ALIYUN_CAPTCHA_PREFIX", "public")
	t.Setenv("ALIYUN_CAPTCHA_SCENE_SLIDER", "env-scene")
	t.Setenv("ALIYUN_CAPTCHA_TIMEOUT_MS", "42")
	f := fake(func(context.Context, *sdk.VerifyIntelligentCaptchaRequest, *dara.RuntimeOptions) (*sdk.VerifyIntelligentCaptchaResponse, error) {
		return response(true), nil
	})
	c, err := NewClient(WithClient(f))
	if err != nil || c.FrontendConfig().Scenes[Slider] != "env-scene" || c.timeout != 42*time.Millisecond {
		t.Fatalf("环境配置：%v", err)
	}
	t.Setenv("ALIYUN_CAPTCHA_TIMEOUT_MS", "-1")
	if _, err = NewClient(WithClient(f)); !errors.Is(err, ErrConfig) {
		t.Fatal(err)
	}
	c, err = NewClient(WithConfig(cfg()), WithClient(f))
	if err != nil || c.FrontendConfig().Scenes[Slider] != "scene" {
		t.Fatal(err)
	}
	t.Setenv("ALIYUN_CAPTCHA_TIMEOUT_MS", "9223372036854775807")
	if _, err = ConfigFromEnv(); !errors.Is(err, ErrConfig) {
		t.Fatal(err)
	}
}

type localHTTP struct{ client *http.Client }

// Call 使用本地测试服务器的可信客户端发送请求。
func (h localHTTP) Call(r *http.Request, _ *http.Transport) (*http.Response, error) {
	return h.client.Do(r)
}

// TestRealTransport 在本地服务检查签名、场景和传输取消。
func TestRealTransport(t *testing.T) {
	received := make(chan struct{}, 1)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Error(err)
		}
		if r.Form.Get("SceneId") != "scene" || (r.Form.Get("CaptchaVerifyParam") != "token" && r.Form.Get("CaptchaVerifyParam") != "wait") || r.Header.Get("Authorization") == "" {
			t.Errorf("请求场景、参数或签名缺失")
		}
		received <- struct{}{}
		if r.Form.Get("CaptchaVerifyParam") == "wait" {
			<-r.Context().Done()
			return
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"Code":"Success","Success":true,"Result":{"VerifyResult":true}}`)
	}))
	defer server.Close()
	cred, err := credentials.NewCredential(&credentials.Config{Type: dara.String("access_key"), AccessKeyId: dara.String("test-id"), AccessKeySecret: dara.String("test-secret")})
	if err != nil {
		t.Fatal(err)
	}
	underlying, err := sdk.NewClient(&openapi.Config{Endpoint: dara.String(strings.TrimPrefix(server.URL, "https://")), Credential: cred})
	if err != nil {
		t.Fatal(err)
	}
	underlying.HttpClient = localHTTP{server.Client()}
	c, err := NewClient(WithConfig(cfg()), WithClient(underlying))
	if err != nil {
		t.Fatal(err)
	}
	if err = c.Verify(context.Background(), Slider, "token"); err != nil {
		t.Fatal(err)
	}
	<-received
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- c.Verify(ctx, Slider, "wait") }()
	<-received
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	c.timeout = 20 * time.Millisecond
	if err := c.Verify(context.Background(), Slider, "wait"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
}
