// 文件类型：错误链测试；用途：验证供应商消息、请求标识及上下文错误不丢失。
// 用法：执行 go test ./captcha；仅使用测试替身，不访问云服务。
package captcha

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	sdk "github.com/alibabacloud-go/captcha-20230305/client"
	"github.com/alibabacloud-go/tea/dara"
)

// TestProviderErrorDetails 检查业务失败和验签拒绝保留供应商诊断。
func TestProviderErrorDetails(t *testing.T) {
	for _, rejected := range []bool{false, true} {
		client, err := NewClient(WithConfig(cfg()), WithClient(fake(func(context.Context, *sdk.VerifyIntelligentCaptchaRequest, *dara.RuntimeOptions) (*sdk.VerifyIntelligentCaptchaResponse, error) {
			resp := response(false)
			resp.Body.RequestId = dara.String("provider-request")
			resp.Body.Message = dara.String("供应商诊断")
			resp.Body.Result.VerifyCode = dara.String("VERIFY_REJECTED")
			if !rejected {
				resp.Body.Code = dara.String("ServiceUnavailable")
			}
			return resp, nil
		})))
		if err != nil {
			t.Fatal(err)
		}
		err = client.Verify(context.Background(), Slider, "test-param")
		want := ErrService
		if rejected {
			want = ErrRejected
		}
		var detail *Error
		if !errors.Is(err, want) || !errors.As(err, &detail) || detail.Code == "" || detail.Message != "供应商诊断" || detail.RequestID != "provider-request" {
			t.Fatalf("供应商详情或分类丢失: %v", err)
		}
		encoded, _ := json.Marshal(detail)
		if string(encoded) != "{}" {
			t.Fatal("诊断错误不得被意外序列化")
		}
	}
}

// TestTransportCauseAndCancellation 确保取消不会覆盖调用器的原始错误。
func TestTransportCauseAndCancellation(t *testing.T) {
	original := errors.New("本地模拟网络故障")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	client, err := NewClient(WithConfig(cfg()), WithClient(fake(func(context.Context, *sdk.VerifyIntelligentCaptchaRequest, *dara.RuntimeOptions) (*sdk.VerifyIntelligentCaptchaResponse, error) {
		cancel()
		return nil, original
	})))
	if err != nil {
		t.Fatal(err)
	}
	err = client.Verify(ctx, Slider, "test-param")
	if !errors.Is(err, ErrTransport) || !errors.Is(err, original) || !errors.Is(err, context.Canceled) {
		t.Fatalf("传输原因或取消分类丢失: %v", err)
	}
}
