# SDK 开发入口；不调用真实阿里云服务，不发布 npm 或 Git 标签。
.PHONY: test build demo server version version-test

test:
	node --test scripts/version.test.mjs scripts/forge-api.test.mjs
	go test ./...
	go vet ./...
	pnpm --dir web test
	pnpm --dir web exec tsc --noEmit

build:
	go build ./...
	pnpm --dir web build
	node scripts/verify-dist.mjs

demo:
	pnpm --dir web dev

server:
	go run ./example

# 只读推导开发版本；创建正式标签仅允许 CI 主线门禁执行。
version:
	node scripts/version.mjs

version-test:
	node --test scripts/version.test.mjs scripts/forge-api.test.mjs
