# SDK 开发入口；不调用真实阿里云服务，不发布 npm 或 Git 标签。
.PHONY: test build demo server

test:
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
