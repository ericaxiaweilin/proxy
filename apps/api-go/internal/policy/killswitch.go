package policy

import "sync"

// P0 AC-15: Global Kill Switch — 无需发版暂停 AI 能力
type KillSwitch struct {
 mu sync.RWMutex
 flags map[string]bool
}
func New() *KillSwitch { return &KillSwitch{flags: map[string]bool{}} }
func (k *KillSwitch) Set(cap string, killed bool) { k.mu.Lock(); k.flags[cap]=killed; k.mu.Unlock() }
func (k *KillSwitch) IsKilled(cap string) bool { k.mu.RLock(); defer k.mu.RUnlock(); return k.flags[cap] }
func (k *KillSwitch) Can(cap string) bool { return !k.IsKilled(cap) }
