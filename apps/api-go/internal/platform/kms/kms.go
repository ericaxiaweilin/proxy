// Package kms — Lotus RFC §4 at-rest encryption placeholder.
// Production uses AWS/GCP KMS; local dev uses AES-256-GCM with a key from
// KMS_LOCAL_KEY (hex 32 bytes) or an in-process random key. The interface is
// deliberately tiny so the conversation/media services can depend on it without
// pulling the cloud SDK. Swap the provider in cmd/api and cmd/worker wiring.
package kms

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"sync"
)

type Provider interface {
	Encrypt(ctx []byte, plaintext []byte) ([]byte, error)
	Decrypt(ctx []byte, ciphertext []byte) ([]byte, error)
}

var ErrDecryptFailed = errors.New("kms decrypt failed")

type localAES struct {
	mu   sync.Mutex
	aead cipher.AEAD
}

func NewLocal() (Provider, error) {
	keyHex := os.Getenv("KMS_LOCAL_KEY")
	var key []byte
	if keyHex != "" {
		b, err := hex.DecodeString(keyHex)
		if err != nil || len(b) != 32 {
			return nil, errors.New("KMS_LOCAL_KEY must be hex 32 bytes (64 hex chars)")
		}
		key = b
	} else {
		key = make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			return nil, err
		}
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &localAES{aead: aead}, nil
}

func (l *localAES) Encrypt(_ []byte, plaintext []byte) ([]byte, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	nonce := make([]byte, l.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return l.aead.Seal(nonce, nonce, plaintext, nil), nil
}

func (l *localAES) Decrypt(_ []byte, ciphertext []byte) ([]byte, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	ns := l.aead.NonceSize()
	if len(ciphertext) < ns {
		return nil, ErrDecryptFailed
	}
	nonce, ct := ciphertext[:ns], ciphertext[ns:]
	pt, err := l.aead.Open(nil, nonce, ct, nil)
	if err != nil {
		return nil, ErrDecryptFailed
	}
	return pt, nil
}

// Noop is used when encryption is disabled (test). Plaintext round-trips.
type noop struct{}
func NewNoop() Provider { return noop{} }
func (noop) Encrypt(_ []byte, p []byte) ([]byte, error) { return p, nil }
func (noop) Decrypt(_ []byte, c []byte) ([]byte, error) { return c, nil }
