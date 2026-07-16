// Package telemetry provides the core's small, bounded Prometheus surface.
package telemetry

import (
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"
)

var durationBuckets = []float64{0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

type DBStats struct {
	Acquired int32
	Idle     int32
	Max      int32
}

type requestKey struct {
	Method      string
	Route       string
	StatusClass string
}

type histogram struct {
	Buckets []uint64
	Count   uint64
	Sum     float64
}

type Metrics struct {
	mu sync.Mutex

	httpRequests        map[requestKey]uint64
	httpDurations       map[requestKey]*histogram
	authFailures        map[string]uint64
	sessionsCreated     uint64
	rateLimitRejections uint64
	dbStats             func() DBStats
}

func New(dbStats func() DBStats) *Metrics {
	return &Metrics{
		httpRequests:  make(map[requestKey]uint64),
		httpDurations: make(map[requestKey]*histogram),
		authFailures:  make(map[string]uint64),
		dbStats:       dbStats,
	}
}

func (m *Metrics) ObserveRequest(method, route string, status int, duration time.Duration) {
	key := requestKey{Method: method, Route: route, StatusClass: fmt.Sprintf("%dxx", status/100)}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.httpRequests[key]++
	h := m.httpDurations[key]
	if h == nil {
		h = &histogram{Buckets: make([]uint64, len(durationBuckets))}
		m.httpDurations[key] = h
	}
	seconds := duration.Seconds()
	for i, bucket := range durationBuckets {
		if seconds <= bucket {
			h.Buckets[i]++
		}
	}
	h.Count++
	h.Sum += seconds
}

func (m *Metrics) IncAuthFailure(reason string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.authFailures[reason]++
}

func (m *Metrics) IncSessionCreated() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessionsCreated++
}

func (m *Metrics) IncRateLimitRejection() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rateLimitRejections++
}

func (m *Metrics) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	m.writePrometheus(w)
}

func (m *Metrics) writePrometheus(w io.Writer) {
	m.mu.Lock()
	requests := cloneMap(m.httpRequests)
	authFailures := cloneMap(m.authFailures)
	durations := make(map[requestKey]histogram, len(m.httpDurations))
	for key, value := range m.httpDurations {
		durations[key] = histogram{Buckets: append([]uint64(nil), value.Buckets...), Count: value.Count, Sum: value.Sum}
	}
	sessionsCreated := m.sessionsCreated
	rateLimitRejections := m.rateLimitRejections
	m.mu.Unlock()

	requestKeys := sortedRequestKeys(requests)
	fmt.Fprintln(w, "# TYPE archura_http_requests_total counter")
	for _, key := range requestKeys {
		fmt.Fprintf(w, "archura_http_requests_total%s %d\n", requestLabels(key), requests[key])
	}

	fmt.Fprintln(w, "# TYPE archura_http_request_duration_seconds histogram")
	for _, key := range sortedRequestKeys(durations) {
		h := durations[key]
		for i, bucket := range durationBuckets {
			fmt.Fprintf(w, "archura_http_request_duration_seconds_bucket%s %d\n",
				requestLabelsWithLE(key, strconv.FormatFloat(bucket, 'g', -1, 64)), h.Buckets[i])
		}
		fmt.Fprintf(w, "archura_http_request_duration_seconds_bucket%s %d\n", requestLabelsWithLE(key, "+Inf"), h.Count)
		fmt.Fprintf(w, "archura_http_request_duration_seconds_sum%s %g\n", requestLabels(key), h.Sum)
		fmt.Fprintf(w, "archura_http_request_duration_seconds_count%s %d\n", requestLabels(key), h.Count)
	}

	fmt.Fprintln(w, "# TYPE archura_auth_failures_total counter")
	reasons := sortedStringKeys(authFailures)
	for _, reason := range reasons {
		fmt.Fprintf(w, "archura_auth_failures_total{reason=%q} %d\n", reason, authFailures[reason])
	}
	fmt.Fprintln(w, "# TYPE archura_component_sessions_created_total counter")
	fmt.Fprintf(w, "archura_component_sessions_created_total %d\n", sessionsCreated)
	fmt.Fprintln(w, "# TYPE archura_rate_limit_rejections_total counter")
	fmt.Fprintf(w, "archura_rate_limit_rejections_total %d\n", rateLimitRejections)

	stats := DBStats{}
	if m.dbStats != nil {
		stats = m.dbStats()
	}
	fmt.Fprintln(w, "# TYPE archura_db_pool_acquired_connections gauge")
	fmt.Fprintf(w, "archura_db_pool_acquired_connections %d\n", stats.Acquired)
	fmt.Fprintln(w, "# TYPE archura_db_pool_idle_connections gauge")
	fmt.Fprintf(w, "archura_db_pool_idle_connections %d\n", stats.Idle)
	fmt.Fprintln(w, "# TYPE archura_db_pool_max_connections gauge")
	fmt.Fprintf(w, "archura_db_pool_max_connections %d\n", stats.Max)
}

func requestLabels(key requestKey) string {
	return fmt.Sprintf("{method=%q,route=%q,status_class=%q}", key.Method, key.Route, key.StatusClass)
}

func requestLabelsWithLE(key requestKey, le string) string {
	return fmt.Sprintf("{method=%q,route=%q,status_class=%q,le=%q}", key.Method, key.Route, key.StatusClass, le)
}

func sortedRequestKeys[V any](values map[requestKey]V) []requestKey {
	keys := make([]requestKey, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		left := keys[i].Method + "\x00" + keys[i].Route + "\x00" + keys[i].StatusClass
		right := keys[j].Method + "\x00" + keys[j].Route + "\x00" + keys[j].StatusClass
		return left < right
	})
	return keys
}

func sortedStringKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func cloneMap[K comparable, V any](source map[K]V) map[K]V {
	clone := make(map[K]V, len(source))
	for key, value := range source {
		clone[key] = value
	}
	return clone
}
