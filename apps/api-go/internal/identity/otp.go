package identity

// OTP generation primitives shared by every real LoginChallengeProvider.
//
// Design contract (matches SimulatedLoginChallengeProvider):
//   - The plain code is never stored, logged, or returned through the domain.
//   - Only the SHA-256 hash lives long enough to verify, and only in memory
//     inside the provider.
//   - The challenge provider MUST return ErrLoginChallengeProviderNotReady
//     for any misconfiguration, transport failure, or upstream rejection —
//     the API remains fail-closed either way.

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
)

const otpCodeLength = 6

// generateOTPCode returns a cryptographically random numeric code of
// otpCodeLength digits, with leading zeros preserved. Values are uniformly
// distributed in [0, 10^otpCodeLength).
func generateOTPCode() (string, error) {
	max := new(big.Int).Exp(big.NewInt(10), big.NewInt(otpCodeLength), nil)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%0*d", otpCodeLength, n.Int64()), nil
}

// hashOTPCode returns a hex-encoded SHA-256 hash of the trimmed code. We
// use SHA-256 (not bcrypt/argon2) because the code has only ~20 bits of
// entropy by design; a slow KDF would buy us nothing and would slow down
// the legitimate verify path.
func hashOTPCode(code string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(code)))
	return hex.EncodeToString(sum[:])
}

// constantTimeEqualHash reports whether the provided code (trimmed) hashes
// to the supplied hex-encoded hash, in constant time relative to the hash
// length. Used by every production provider's Verify path.
func constantTimeEqualHash(providedCode, storedHexHash string) bool {
	want, err := hex.DecodeString(storedHexHash)
	if err != nil {
		return false
	}
	got := sha256.Sum256([]byte(strings.TrimSpace(providedCode)))
	return subtle.ConstantTimeCompare(want, got[:]) == 1
}
