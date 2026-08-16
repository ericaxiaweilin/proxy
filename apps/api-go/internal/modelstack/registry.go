package modelstack

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// ListRegisteredTaskIDs 读取底座业务任务注册表，返回已注册任务 ID 集合。
// 供任务同步工具做幂等注册，运行时代码不应依赖它。
func (c *ControlPlaneClient) ListRegisteredTaskIDs(ctx context.Context) (map[string]bool, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/model-management/business-tasks", nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrControlPlaneUnavailable, err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: business-tasks registry returned %d", ErrControlPlaneUnavailable, response.StatusCode)
	}
	var payload struct {
		Status string `json:"status"`
		Tasks  []struct {
			ID string `json:"id"`
		} `json:"tasks"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	ids := make(map[string]bool, len(payload.Tasks))
	for _, task := range payload.Tasks {
		ids[task.ID] = true
	}
	return ids, nil
}

// CreateTask 在底座注册一个业务任务定义。任务定义是自由结构 JSON，
// 字段对齐底座业务任务注册表 schema（id / project_id / module / kind / ...）。
func (c *ControlPlaneClient) CreateTask(ctx context.Context, task json.RawMessage) error {
	payload, err := json.Marshal(map[string]json.RawMessage{"task": task})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/model-management/business-tasks", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return err
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("task create rejected with status %d: %s", response.StatusCode, truncate(string(body), 400))
	}
	return nil
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "..."
}
