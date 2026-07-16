# Build
FROM golang:1.24-alpine AS build
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_TIME=unknown
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build \
    -ldflags "-X github.com/archura/core/internal/buildinfo.Version=${VERSION} -X github.com/archura/core/internal/buildinfo.Commit=${COMMIT} -X github.com/archura/core/internal/buildinfo.BuildTime=${BUILD_TIME}" \
    -o /out/server ./cmd/server && \
    CGO_ENABLED=0 go build -o /out/maintenance ./cmd/maintenance

# Run
FROM alpine:3.20
RUN apk add --no-cache ca-certificates && \
    addgroup -S archura && \
    adduser -S -G archura archura
COPY --from=build /out/server /server
COPY --from=build /out/maintenance /maintenance
ENV PORT=8080
EXPOSE 8080
EXPOSE 9091
USER archura
ENTRYPOINT ["/server"]
