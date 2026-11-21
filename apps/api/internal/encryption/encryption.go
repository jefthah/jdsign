// Package encryption seals small secrets, such as admin TOTP secrets, with AES-256-GCM.
//
// Keys are numbered so they can be rotated. ENCRYPTION_KEYS lists them as "id:hex", separated by
// commas; the first key encrypts and every listed key can still decrypt. A sealed value is
// key id (1 byte) || nonce (12 bytes) || ciphertext and tag. See docs/spec.md section 17.
package encryption

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

const (
	// KeySize is the AES-256 key length in bytes.
	KeySize   = 32
	nonceSize = 12
)

// ErrCannotOpen means a sealed value is damaged, belongs to another context, or uses a key that
// is no longer configured.
var ErrCannotOpen = errors.New("data terenkripsi tidak dapat dibuka")

// Keyring holds the configured keys. It is safe for concurrent use.
type Keyring struct {
	current byte
	ciphers map[byte]cipher.AEAD
}

// ParseKeys reads ENCRYPTION_KEYS, for example "2:<64 hex>,1:<64 hex>". Key ids are 1 to 255.
func ParseKeys(value string) (*Keyring, error) {
	entries := strings.Split(value, ",")
	keyring := &Keyring{ciphers: make(map[byte]cipher.AEAD, len(entries))}

	for position, entry := range entries {
		rawID, rawKey, found := strings.Cut(strings.TrimSpace(entry), ":")
		if !found {
			return nil, fmt.Errorf("ENCRYPTION_KEYS entri ke-%d harus berbentuk id:kunci-hex", position+1)
		}
		id, err := strconv.ParseUint(rawID, 10, 8)
		if err != nil || id == 0 {
			return nil, fmt.Errorf("ENCRYPTION_KEYS entri ke-%d: id kunci harus angka 1 sampai 255", position+1)
		}
		key, err := hex.DecodeString(rawKey)
		if err != nil || len(key) != KeySize {
			return nil, fmt.Errorf("ENCRYPTION_KEYS kunci %d harus 64 karakter hex (32 byte); buat dengan: openssl rand -hex 32", id)
		}
		if _, exists := keyring.ciphers[byte(id)]; exists {
			return nil, fmt.Errorf("ENCRYPTION_KEYS memuat id kunci %d lebih dari sekali", id)
		}

		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, err
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, err
		}
		keyring.ciphers[byte(id)] = aead
		if position == 0 {
			keyring.current = byte(id)
		}
	}

	return keyring, nil
}

// Seal encrypts plaintext with the current key. context binds the result to where it is stored
// (for example "users.totp_secret:42"), so a value copied to another row cannot be opened.
func (k *Keyring) Seal(plaintext []byte, context string) ([]byte, error) {
	nonce := make([]byte, nonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}

	sealed := make([]byte, 0, 1+nonceSize+len(plaintext)+k.ciphers[k.current].Overhead())
	sealed = append(sealed, k.current)
	sealed = append(sealed, nonce...)

	return k.ciphers[k.current].Seal(sealed, nonce, plaintext, []byte(context)), nil
}

// Open decrypts a value from Seal. It returns ErrCannotOpen when the value cannot be trusted.
func (k *Keyring) Open(sealed []byte, context string) ([]byte, error) {
	if len(sealed) < 1+nonceSize {
		return nil, ErrCannotOpen
	}
	aead, ok := k.ciphers[sealed[0]]
	if !ok {
		return nil, ErrCannotOpen
	}

	plaintext, err := aead.Open(nil, sealed[1:1+nonceSize], sealed[1+nonceSize:], []byte(context))
	if err != nil {
		return nil, ErrCannotOpen
	}

	return plaintext, nil
}
