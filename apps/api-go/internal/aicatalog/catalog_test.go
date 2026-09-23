package aicatalog

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeCatalog(t *testing.T, dir, version string, freeImages int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "logos"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "logos", "openai.svg"), []byte(`<svg viewBox="0 0 24 24"></svg>`), 0o644); err != nil {
		t.Fatal(err)
	}
	body := `{"version":"` + version + `","imageBilling":{"payer":"user","freeImagesPerMonth":` + itoa(freeImages) + `,"freeVendor":"openai","priceNotice":"n"},
"chatBilling":{"payer":"platform","pricePer1kTokens":null},
"vendors":[{"id":"openai","name":"OpenAI","desc":"d","logo":"logos/openai.svg","logoBg":"#10a37f","rank":{"quality":9,"price":0.01,"popular":10},
"models":[{"name":"GPT-Image-1","price":{"label":"$0.04-0.17/张","currency":"USD","min":0.04,"max":0.17,"unit":"image"}}]}]}`
	if err := os.WriteFile(filepath.Join(dir, "catalog.json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := ""
	for n > 0 {
		digits = string(rune('0'+n%10)) + digits
		n /= 10
	}
	return digits
}

func TestLoadInlinesLogosAndPrices(t *testing.T) {
	dir := t.TempDir()
	writeCatalog(t, dir, "v1", 10)
	catalog, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Vendors[0].LogoSVG == "" || catalog.ImageBilling.FreeImagesPerMonth != 10 {
		t.Fatalf("logo and free quota must come from the files: %+v", catalog)
	}
	if p := catalog.Vendors[0].Models[0].Price; p.Min == nil || *p.Min != 0.04 || p.Unit != "image" {
		t.Fatalf("numeric price must come from the file: %+v", p)
	}
}

func TestStoreReloadsWhenTheFileChangesAndKeepsTheLastGoodOnBadFiles(t *testing.T) {
	dir := t.TempDir()
	writeCatalog(t, dir, "v1", 10)
	store := NewStore(dir)
	first, err := store.Current()
	if err != nil || first.Version != "v1" {
		t.Fatalf("first load: %+v %v", first.Version, err)
	}

	// 运营改了免费额度：不重启，下次读取就是新值。
	time.Sleep(10 * time.Millisecond)
	writeCatalog(t, dir, "v2", 20)
	later := time.Now().Add(2 * time.Second)
	_ = os.Chtimes(filepath.Join(dir, "catalog.json"), later, later)
	second, _ := store.Current()
	if second.Version != "v2" || second.ImageBilling.FreeImagesPerMonth != 20 {
		t.Fatalf("an edited catalog must be picked up without a restart: %+v", second)
	}

	// 坏文件：继续用上一份好的，不把线上打挂。
	if err := os.WriteFile(filepath.Join(dir, "catalog.json"), []byte(`{broken`), 0o644); err != nil {
		t.Fatal(err)
	}
	evenLater := time.Now().Add(4 * time.Second)
	_ = os.Chtimes(filepath.Join(dir, "catalog.json"), evenLater, evenLater)
	third, err := store.Current()
	if err != nil || third.Version != "v2" {
		t.Fatalf("a broken catalog must keep serving the last good one: %+v %v", third.Version, err)
	}
}

func TestRepoCatalogIsValid(t *testing.T) {
	// 仓库里那份真目录必须能被加载（运营改坏了这里会红）。
	dir := filepath.Join("..", "..", "..", "..", "config", "ai-catalog")
	catalog, err := Load(dir)
	if err != nil {
		t.Fatalf("config/ai-catalog must load: %v", err)
	}
	if catalog.Vendors[0].ID != "platform_default" || !catalog.Vendors[0].Pinned {
		t.Fatalf("platform default must stay pinned first: %+v", catalog.Vendors[0])
	}
}
