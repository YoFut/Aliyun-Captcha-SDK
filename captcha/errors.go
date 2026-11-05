// 文件类型：SDK 错误；用途：向后端保留供应商诊断及错误链。
// 用法：通过 errors.Is 判断分类，通过 errors.As 读取详情；禁止直接作为 HTTP 响应。
package captcha

import "fmt"

// Error 保留供应商错误详情，仅供调用方后端诊断。
type Error struct {
	Code      string `json:"-"`
	Message   string `json:"-"`
	RequestID string `json:"-"`
	Cause     error  `json:"-"`
	kind      error
}

// Error 返回服务诊断文本；调用方不得把该文本直接返回终端用户或未经脱敏写日志。
func (e *Error) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %v", e.kind, e.Cause)
	}
	return fmt.Sprintf("%s [%s]: %s", e.kind, e.Code, e.Message)
}

// Unwrap 保留底层错误，允许识别网络异常和上下文取消。
func (e *Error) Unwrap() error { return e.Cause }

// Is 保留 SDK 分类，不影响底层错误链的检查。
func (e *Error) Is(target error) bool { return target == e.kind }
