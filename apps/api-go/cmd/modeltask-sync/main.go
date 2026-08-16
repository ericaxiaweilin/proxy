// Command modeltask-sync 把 Proxy 的业务任务目录幂等注册到模型底座。
//
// 用法：
//
//	MODELSTACK_CONTROL_PLANE_URL=http://100.96.188.77:14041 \
//	go run ./cmd/modeltask-sync -catalog modeltasks/proxy_tasks.json
//
// 业务侧契约：Proxy 只持有任务 ID；模型选择、Provider、凭证、failover
// 全部由底座负责，因此任务定义必须先在底座注册，业务调用才允许发生。
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/proxy-app/proxy-api/internal/modelstack"
)

type taskCatalog struct {
	ProjectID string            `json:"project_id"`
	Tasks     []json.RawMessage `json:"tasks"`
}

type taskMeta struct {
	ID string `json:"id"`
}

func main() {
	catalogPath := flag.String("catalog", "modeltasks/proxy_tasks.json", "path to proxy business task catalog")
	controlPlaneURL := flag.String("control-plane", os.Getenv("MODELSTACK_CONTROL_PLANE_URL"), "model stack control plane base URL")
	dryRun := flag.Bool("dry-run", false, "only show which tasks would be created")
	flag.Parse()

	if *controlPlaneURL == "" {
		log.Fatal("model stack control plane URL missing: set MODELSTACK_CONTROL_PLANE_URL or -control-plane")
	}
	data, err := os.ReadFile(*catalogPath)
	if err != nil {
		log.Fatalf("read catalog: %v", err)
	}
	var catalog taskCatalog
	if err := json.Unmarshal(data, &catalog); err != nil {
		log.Fatalf("parse catalog: %v", err)
	}
	if len(catalog.Tasks) == 0 {
		log.Fatal("catalog contains no tasks")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	client := modelstack.NewControlPlaneClient(*controlPlaneURL)
	registered, err := client.ListRegisteredTaskIDs(ctx)
	if err != nil {
		log.Fatalf("read model stack task registry: %v", err)
	}

	created, skipped, failed := 0, 0, 0
	for _, raw := range catalog.Tasks {
		var meta taskMeta
		if err := json.Unmarshal(raw, &meta); err != nil || meta.ID == "" {
			log.Printf("SKIP invalid task definition: %v", err)
			failed++
			continue
		}
		if registered[meta.ID] {
			log.Printf("SKIP %s (already registered)", meta.ID)
			skipped++
			continue
		}
		if *dryRun {
			log.Printf("WOULD CREATE %s", meta.ID)
			continue
		}
		if err := client.CreateTask(ctx, raw); err != nil {
			log.Printf("FAIL %s: %v", meta.ID, err)
			failed++
			continue
		}
		log.Printf("CREATED %s", meta.ID)
		created++
	}
	fmt.Printf("modeltask-sync: created=%d skipped=%d failed=%d\n", created, skipped, failed)
	if failed > 0 {
		os.Exit(1)
	}
}
