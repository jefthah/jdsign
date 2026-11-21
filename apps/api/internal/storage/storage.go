// Package storage keeps template files on the private disk under STORAGE_DIR, outside anything
// the web server serves (docs/spec.md 7.3). Paths stored in the database are relative to it.
//
// Files are written to STORAGE_DIR/tmp first and renamed into place once complete, so a file
// that a database row points at is never half written.
package storage

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
)

// Store is a directory of uploaded files.
type Store struct {
	root string
}

// Open prepares the directory, creating it when needed.
func Open(dir string) (*Store, error) {
	root, err := filepath.Abs(dir)
	if err != nil {
		return nil, fmt.Errorf("STORAGE_DIR %q: %w", dir, err)
	}
	if err := os.MkdirAll(filepath.Join(root, "tmp"), 0o750); err != nil {
		return nil, fmt.Errorf("menyiapkan STORAGE_DIR %q: %w", root, err)
	}

	return &Store{root: root}, nil
}

// CreateTemp returns an empty file for an upload in progress. Pass it to Commit, or Discard it.
func (s *Store) CreateTemp() (*os.File, error) {
	return os.CreateTemp(filepath.Join(s.root, "tmp"), "upload-*")
}

// Discard closes and deletes a temporary file that will not be committed.
func Discard(file *os.File) {
	_ = file.Close()
	_ = os.Remove(file.Name())
}

// Commit flushes the temporary file to disk and moves it to the relative path name.
// The temporary file is gone afterwards, whether or not Commit succeeds.
func (s *Store) Commit(file *os.File, name string) error {
	target, err := s.path(name)
	if err != nil {
		Discard(file)
		return err
	}
	if err := file.Sync(); err != nil {
		Discard(file)
		return err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(file.Name())
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		_ = os.Remove(file.Name())
		return err
	}
	if err := os.Rename(file.Name(), target); err != nil {
		_ = os.Remove(file.Name())
		return err
	}

	return nil
}

// OpenFile opens a stored file for reading. A missing file returns an error matching fs.ErrNotExist.
func (s *Store) OpenFile(name string) (*os.File, fs.FileInfo, error) {
	full, err := s.path(name)
	if err != nil {
		return nil, nil, err
	}
	file, err := os.Open(full)
	if err != nil {
		return nil, nil, err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, nil, err
	}

	return file, info, nil
}

// Remove deletes a stored file. Removing a file that is already gone is not an error.
func (s *Store) Remove(name string) error {
	full, err := s.path(name)
	if err != nil {
		return err
	}
	if err := os.Remove(full); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}

	return nil
}

// NewName returns a fresh relative path such as "templates/7/<32 hex>.zip".
func NewName(kind string, ownerID int64, extension string) (string, error) {
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}

	return path.Join(kind, fmt.Sprint(ownerID), hex.EncodeToString(random)+extension), nil
}

// path turns a stored relative path into an absolute one, refusing anything that would leave
// the storage directory.
func (s *Store) path(name string) (string, error) {
	if !filepath.IsLocal(filepath.FromSlash(name)) {
		return "", fmt.Errorf("path file %q tidak valid", name)
	}

	return filepath.Join(s.root, filepath.FromSlash(name)), nil
}
