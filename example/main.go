// 命令 example 提供标准库 HTTP 接入示例；运行 go run ./example 启动回环服务。
// 文件类型：示例入口，展示公开配置、四字段错误边界和服务端验签。
// 演示路由不替代实际业务请求内的验证；服务不可用时默认拒绝。
package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/YoFut/Aliyun-Captcha-SDK/captcha"
)

// verifier 只暴露示例所需的公开配置和验签能力，不接触调用方凭据。
type verifier interface {
	// FrontendConfig 返回可提供给浏览器的独立配置副本，不包含云凭据。
	FrontendConfig() captcha.FrontendConfig
	// Verify 仅在服务端验签通过时返回 nil，取消与依赖错误必须拒绝业务。
	Verify(context.Context, captcha.Kind, string) error
}

// failureResponse 限制错误响应为 YoFut 约定的四个安全字段。
type failureResponse struct {
	Code      int    `json:"code"`
	Message   string `json:"message"`
	Data      any    `json:"data"`
	RequestID string `json:"request_id"`
}

// writeFailure 只输出预定义文案，data 保持 null，不透传上游错误或请求参数。
func writeFailure(w http.ResponseWriter, status, code int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(failureResponse{Code: code, Message: message, Data: nil, RequestID: w.Header().Get("X-Request-ID")})
}

// writeDecodeFailure 区分超限与非法 JSON，避免把原始解码错误返回客户端。
func writeDecodeFailure(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeFailure(w, http.StatusRequestEntityTooLarge, 41301, "请求内容过大")
		return
	}
	writeFailure(w, http.StatusBadRequest, 40001, "请求参数不符合要求")
}

// handler 以请求级随机标识关联错误，对未知路径及不支持的方法使用相同错误契约。
func handler(client verifier) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/captcha/config", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeFailure(w, http.StatusMethodNotAllowed, 40501, "请求方法不支持")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(client.FrontendConfig())
	})
	mux.HandleFunc("/captcha/verify", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeFailure(w, http.StatusMethodNotAllowed, 40501, "请求方法不支持")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		var req struct {
			Kind               captcha.Kind `json:"kind"`
			CaptchaVerifyParam string       `json:"captcha_verify_param"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil {
			writeDecodeFailure(w, err)
			return
		}
		var extra interface{}
		if err := dec.Decode(&extra); err != io.EOF {
			writeDecodeFailure(w, err)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		err := client.Verify(ctx, req.Kind, req.CaptchaVerifyParam)
		if errors.Is(err, captcha.ErrInput) {
			writeFailure(w, http.StatusBadRequest, 40001, "请求参数不符合要求")
		} else if errors.Is(err, captcha.ErrRejected) {
			writeFailure(w, http.StatusForbidden, 40301, "人机验证未通过")
		} else if errors.Is(err, captcha.ErrTransport) || errors.Is(err, captcha.ErrService) || errors.Is(err, captcha.ErrConfig) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			writeFailure(w, http.StatusServiceUnavailable, 50301, "验证服务暂时不可用")
		} else if err != nil {
			writeFailure(w, http.StatusInternalServerError, 50001, "服务暂时出现问题")
		} else {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(struct {
				Verified bool `json:"verified"`
			}{true})
		}
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		writeFailure(w, http.StatusNotFound, 40401, "请求的接口不存在")
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-ID", rand.Text())
		mux.ServeHTTP(w, r)
	})
}

// main 使用调用方环境配置启动示例，不输出凭据或供应商原始错误。
func main() {
	client, err := captcha.NewClient()
	if err != nil {
		slog.Error("验证码配置或凭据初始化失败")
		os.Exit(1)
	}
	server := &http.Server{Addr: "127.0.0.1:8080", Handler: handler(client), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second}
	slog.Info("示例服务监听 127.0.0.1:8080")
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("示例服务启动失败")
		os.Exit(1)
	}
}
