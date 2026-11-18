package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// setupIntegrityTest resets the overridable globals and counts hash calls.
func setupIntegrityTest(t *testing.T) *int {
	t.Helper()
	oldMax, oldHash, oldNow := integrityMaxFileSize, integrityHashFunc, integrityNow
	calls := 0
	integrityHashFunc = func(p string) (string, error) {
		calls++
		return computeFileHash(p)
	}
	t.Cleanup(func() {
		integrityMaxFileSize, integrityHashFunc, integrityNow = oldMax, oldHash, oldNow
	})
	return &calls
}

func writeAt(t *testing.T, path, content string, mtime time.Time) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, mtime, mtime); err != nil {
		t.Fatal(err)
	}
}

func newTestAgent() *Agent {
	return &Agent{fileHashes: make(map[string]fileHashEntry)}
}

func runCheck(a *Agent, root string, skip map[string]bool, critical []string) []SecurityFinding {
	a.fileHashesMu.Lock()
	defer a.fileHashesMu.Unlock()
	return checkIntegrityPaths(collectIntegrityPathsFrom([]string{root}, skip, critical), a.fileHashes)
}

func TestIntegrityBaselineChangeUnchanged(t *testing.T) {
	calls := setupIntegrityTest(t)
	dir := t.TempDir()
	f := filepath.Join(dir, "conf")
	base := time.Now().Add(-time.Hour)
	writeAt(t, f, "one", base)
	a := newTestAgent()

	if got := runCheck(a, dir, nil, nil); len(got) != 0 {
		t.Fatalf("baseline must not produce findings, got %v", got)
	}
	if *calls != 1 {
		t.Fatalf("expected 1 hash call, got %d", *calls)
	}

	// Unchanged: no finding, no re-hash.
	if got := runCheck(a, dir, nil, nil); len(got) != 0 || *calls != 1 {
		t.Fatalf("unchanged: findings=%v calls=%d", got, *calls)
	}

	// Changed content with new mtime: finding.
	writeAt(t, f, "two", base.Add(time.Minute))
	got := runCheck(a, dir, nil, nil)
	if len(got) != 1 || got[0].TargetPath != f || got[0].Severity != "high" ||
		got[0].Message != "File modified: "+f || got[0].Hash == "" {
		t.Fatalf("expected one modified finding, got %+v", got)
	}
	if *calls != 2 {
		t.Fatalf("expected 2 hash calls, got %d", *calls)
	}

	// Same change is not reported again.
	if got := runCheck(a, dir, nil, nil); len(got) != 0 {
		t.Fatalf("unexpected repeat findings %v", got)
	}
}

func TestIntegrityRehashAfter24h(t *testing.T) {
	calls := setupIntegrityTest(t)
	dir := t.TempDir()
	f := filepath.Join(dir, "conf")
	mtime := time.Now().Add(-time.Hour)
	writeAt(t, f, "aaa", mtime)
	a := newTestAgent()
	runCheck(a, dir, nil, nil)

	// Content changed but size and mtime forged to be identical.
	writeAt(t, f, "bbb", mtime)
	if got := runCheck(a, dir, nil, nil); len(got) != 0 || *calls != 1 {
		t.Fatalf("within 24h cache is trusted: findings=%v calls=%d", got, *calls)
	}

	integrityNow = func() time.Time { return time.Now().Add(25 * time.Hour) }
	got := runCheck(a, dir, nil, nil)
	if len(got) != 1 || got[0].TargetPath != f {
		t.Fatalf("expected finding after forced rehash, got %v", got)
	}
}

func TestIntegrityRemovedFile(t *testing.T) {
	setupIntegrityTest(t)
	dir := t.TempDir()
	f := filepath.Join(dir, "conf")
	writeAt(t, f, "x", time.Now().Add(-time.Hour))
	a := newTestAgent()
	runCheck(a, dir, nil, nil)

	os.Remove(f)
	got := runCheck(a, dir, nil, nil)
	if len(got) != 1 || got[0].Message != "File removed: "+f || got[0].Severity != "high" {
		t.Fatalf("expected removed finding, got %+v", got)
	}
	if len(a.fileHashes) != 0 {
		t.Fatal("removed file must be dropped from cache")
	}
}

func TestIntegritySkipsLargeFiles(t *testing.T) {
	calls := setupIntegrityTest(t)
	integrityMaxFileSize = 10
	dir := t.TempDir()
	mtime := time.Now().Add(-time.Hour)
	writeAt(t, filepath.Join(dir, "big"), "0123456789ABCDEF", mtime)
	writeAt(t, filepath.Join(dir, "small"), "ok", mtime)
	a := newTestAgent()

	runCheck(a, dir, nil, nil)
	if *calls != 1 {
		t.Fatalf("only the small file may be hashed, calls=%d", *calls)
	}
	if _, ok := a.fileHashes[filepath.Join(dir, "big")]; ok {
		t.Fatal("large file must not be in cache")
	}
}

func TestIntegritySkipDirsAndCritical(t *testing.T) {
	setupIntegrityTest(t)
	dir := t.TempDir()
	skip := filepath.Join(dir, "skipme")
	if err := os.Mkdir(skip, 0o755); err != nil {
		t.Fatal(err)
	}
	mtime := time.Now().Add(-time.Hour)
	writeAt(t, filepath.Join(skip, "a"), "a", mtime)
	writeAt(t, filepath.Join(dir, "b"), "b", mtime)
	outside := filepath.Join(t.TempDir(), "crit")
	writeAt(t, outside, "c", mtime)

	paths := collectIntegrityPathsFrom([]string{dir, filepath.Join(dir, "missing-root")},
		map[string]bool{skip: true}, []string{outside, filepath.Join(dir, "b")})
	if len(paths) != 2 {
		t.Fatalf("expected b and critical file once each, got %v", paths)
	}
}
