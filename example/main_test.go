// 文件类型：示例 HTTP 契约测试，验证四字段安全错误及请求边界。
// 用法：执行 go test ./example，不访问真实阿里云服务。
package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/YoFut/Aliyun-Captcha-SDK/captcha"
)

// stub 提供固定验签结果，避免契约测试调用云接口。
type stub struct{ err error }

// FrontendConfig 返回不含凭据的最小公开配置。
func (s stub) FrontendConfig() captcha.FrontendConfig { return captcha.FrontendConfig{Region: "cn"} }

// Verify 返回预设错误，不读取或记录验证参数。
func (s stub) Verify(context.Context, captcha.Kind, string) error { return s.err }

// assertFailure 验证安全字段、空数据及服务端生成的关联标识。
func assertFailure(t *testing.T, recorder *httptest.ResponseRecorder, code int) {
	t.Helper()
	var body map[string]json.RawMessage
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil || len(body) != 4 {
		t.Fatalf("错误响应不符合四字段契约：%s", recorder.Body.String())
	}
	for _, field := range []string{"code", "message", "data", "request_id"} {
		if _, exists := body[field]; !exists {
			t.Fatalf("错误响应缺少字段 %s", field)
		}
	}
	var gotCode int
	var message, requestID string
	if json.Unmarshal(body["code"], &gotCode) != nil || gotCode != code || string(body["data"]) != "null" || json.Unmarshal(body["message"], &message) != nil || message == "" || json.Unmarshal(body["request_id"], &requestID) != nil || !regexp.MustCompile(`^[A-Za-z0-9_-]+$`).MatchString(requestID) || requestID != recorder.Header().Get("X-Request-ID") {
		t.Fatalf("错误响应字段内容异常：%s", recorder.Body.String())
	}
}

// TestHandler 验证输入、依赖和权限失败均不透传验证参数或上游诊断。
func TestHandler(t *testing.T) {
	valid := `{"kind":"slider","captcha_verify_param":"private-token"}`
	for _, scenario := range []struct {
		name, body   string
		err          error
		status, code int
	}{
		{"通过", valid, nil, 200, 0},
		{"输入无效", valid, captcha.ErrInput, 400, 40001},
		{"未通过", valid, captcha.ErrRejected, 403, 40301},
		{"依赖故障", valid, captcha.ErrTransport, 503, 50301},
		{"上游异常", valid, captcha.ErrService, 503, 50301},
		{"取消", valid, context.Canceled, 503, 50301},
		{"未知故障", valid, errors.New("secret"), 500, 50001},
		{"多个JSON", `{"kind":"slider"} {}`, nil, 400, 40001},
		{"未知字段", `{"unknown":true}`, nil, 400, 40001},
		{"超限", strings.Repeat(" ", 65537), nil, 413, 41301},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/captcha/verify", strings.NewReader(scenario.body))
			request.Header.Set("X-Request-ID", "untrusted-input")
			handler(stub{scenario.err}).ServeHTTP(recorder, request)
			if recorder.Code != scenario.status || strings.Contains(recorder.Body.String(), "secret") || strings.Contains(recorder.Body.String(), "private-token") || recorder.Header().Get("X-Request-ID") == "untrusted-input" {
				t.Fatalf("状态 %d，响应 %s", recorder.Code, recorder.Body.String())
			}
			if scenario.status == 200 {
				if strings.TrimSpace(recorder.Body.String()) != `{"verified":true}` {
					t.Fatal(recorder.Body.String())
				}
			} else {
				assertFailure(t, recorder, scenario.code)
			}
		})
	}
}

// TestRoutes 验证公开配置及方法、路径错误不返回 HTML 或纯文本。
func TestRoutes(t *testing.T) {
	for _, scenario := range []struct {
		method, path string
		status, code int
	}{
		{http.MethodGet, "/captcha/config", 200, 0},
		{http.MethodPost, "/captcha/config", 405, 40501},
		{http.MethodGet, "/captcha/verify", 405, 40501},
		{http.MethodGet, "/unknown", 404, 40401},
	} {
		recorder := httptest.NewRecorder()
		handler(stub{}).ServeHTTP(recorder, httptest.NewRequest(scenario.method, scenario.path, nil))
		if recorder.Code != scenario.status {
			t.Fatal(recorder.Code)
		}
		if scenario.status == 200 {
			if !strings.Contains(recorder.Body.String(), `"region":"cn"`) {
				t.Fatal(recorder.Body.String())
			}
		} else {
			assertFailure(t, recorder, scenario.code)
		}
	}
}
