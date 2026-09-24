package api

import (
	"log"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/proxy-app/proxy-api/internal/aicatalog"
)

// AI-MANAGE-007: GET /v1/ai/catalog —— 运营维护的 AI 目录（出图厂商 / 模型 / 价格 / logo /
// 免费额度 / 聊天 Token 付费方），来自 config/ai-catalog/ 下的文件，不写在代码里。
// 文件改了自动重载（见 internal/aicatalog）；AI_CATALOG_DIR 可指向同步任务写的目录。
// 目录本身是公开价目表，匿名可读（与 /v1/ai/assistants 同口径）。

var (
	aiCatalogOnce  sync.Once
	aiCatalogStore *aicatalog.Store
)

func sharedAICatalog() *aicatalog.Store {
	aiCatalogOnce.Do(func() {
		dir := strings.TrimSpace(os.Getenv("AI_CATALOG_DIR"))
		if dir == "" {
			dir = resolveRepoDir("config/ai-catalog")
		}
		aiCatalogStore = aicatalog.NewStore(dir)
	})
	return aiCatalogStore
}

func (s *Server) getAICatalog(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	catalog, err := sharedAICatalog().Current()
	if err != nil {
		log.Printf("ai catalog: unavailable from %s: %v", sharedAICatalog().Dir(), err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "AI_CATALOG_UNAVAILABLE"})
		return
	}
	for i := range catalog.Vendors {
		catalog.Vendors[i].Logo = "" // 客户端只要内联 SVG，不暴露服务器目录结构
	}
	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, http.StatusOK, catalog)
}
