package main

import (
	"bufio"
	"flag"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
)

// The sweep grid. The sizes are the ones the app actually ships: storefront card
// 104, personalmanage card 160, invite 168, personalqr page 208, zoom overlay ~296
// (88 is one step below the smallest, to show the margin going).
var (
	sweepSizes  = []int{88, 104, 128, 168, 208, 296}
	sweepRatios = []float64{0.0, 0.20, 0.24, 0.28}
	sweepNames  = []string{"profile", "invite", "store"}
	sweepScales = []int{1, 3}
)

func run(args []string) error {
	fs := flag.NewFlagSet("qrcases", flag.ContinueOnError)
	component := fs.String("component", "", "proxy-qr-code.tsx to take the geometry constants from")
	if err := fs.Parse(args); err != nil {
		return err
	}
	rest := fs.Args()
	if len(rest) != 2 {
		return fmt.Errorf("usage: qrcases <matrixdir> <outdir> [-component <tsx>]")
	}
	matrixDir, outDir := rest[0], rest[1]

	root := repoRoot()
	tsx := *component
	if tsx == "" {
		tsx = filepath.Join(root, "apps", "mobile", "src", "components", "proxy-qr-code.tsx")
	}
	geo, err := readGeometry(tsx)
	if err != nil {
		return err
	}
	logoPath := filepath.Join(root, "apps", "mobile", "assets", "proxy-qr-logo.png")
	logo, err := loadImage(logoPath)
	if err != nil {
		return fmt.Errorf("logo %s: %w", logoPath, err)
	}

	matrices := make(map[string][][]bool, len(sweepNames))
	for _, name := range sweepNames {
		path := filepath.Join(matrixDir, "matrix-"+name+".txt")
		matrix, err := readMatrix(path)
		if err != nil {
			return fmt.Errorf("matrix for %s: %w", name, err)
		}
		matrices[name] = matrix
		fmt.Printf("%-8s %dx%d\n", name, len(matrix), len(matrix[0]))
	}

	// The output directory is this tool's own scratch (run.sh passes $OUT/cases) and
	// stale PNGs from an older grid would be counted as part of the new sweep.
	if outDir == "" || outDir == "/" || outDir == "." || outDir == root {
		return fmt.Errorf("refusing to clear the output directory %q", outDir)
	}
	if err := os.RemoveAll(outDir); err != nil {
		return fmt.Errorf("clear %s: %w", outDir, err)
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return fmt.Errorf("create %s: %w", outDir, err)
	}

	count := 0
	for _, scale := range sweepScales {
		for _, name := range sweepNames {
			for _, size := range sweepSizes {
				for _, ratio := range sweepRatios {
					file := filepath.Join(outDir, fmt.Sprintf("%s_%dpx_%02d_%dx.png", name, size, int(ratio*100), scale))
					if err := writeCase(file, size*scale, matrices[name], geo, logo, ratio); err != nil {
						return err
					}
					count++
				}
			}
		}
	}
	fmt.Printf("rendered %d cases to %s\n", count, outDir)
	return nil
}

func writeCase(file string, size int, matrix [][]bool, geo geometry, logo image.Image, ratio float64) error {
	f, err := os.Create(file)
	if err != nil {
		return fmt.Errorf("create %s: %w", file, err)
	}
	if err := png.Encode(f, render(size, matrix, geo, logo, ratio)); err != nil {
		f.Close()
		return fmt.Errorf("encode %s: %w", file, err)
	}
	return f.Close()
}

// readMatrix reads one exported module grid: rows of '0'/'1', no separators.
func readMatrix(path string) ([][]bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var rows [][]bool
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		row := make([]bool, len(line))
		for i := 0; i < len(line); i++ {
			switch line[i] {
			case '0':
			case '1':
				row[i] = true
			default:
				return nil, fmt.Errorf("%s line %d: unexpected character %q", path, len(rows)+1, string(line[i]))
			}
		}
		if len(rows) > 0 && len(row) != len(rows[0]) {
			return nil, fmt.Errorf("%s: line %d has %d modules, line 1 has %d", path, len(rows)+1, len(row), len(rows[0]))
		}
		rows = append(rows, row)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	// An empty matrix renders a blank field, which fails to decode like any real
	// geometry bug would. Report it as what it is: nothing was exported.
	if len(rows) == 0 {
		return nil, fmt.Errorf("%s is empty — step 1 (export-matrices) wrote no modules", path)
	}
	return rows, nil
}

func loadImage(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return png.Decode(f)
}

// repoRoot walks up from the working directory to the repository root, so the tool
// works whether it is launched by run.sh, from apps/api-go, or from the repo root.
func repoRoot() string {
	for _, key := range []string{"PROXY_ROOT", "REPO_ROOT"} {
		if root := os.Getenv(key); root != "" {
			return root
		}
	}
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	for dir := wd; ; dir = filepath.Dir(dir) {
		if _, err := os.Stat(filepath.Join(dir, "apps", "mobile", "package.json")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return wd
		}
	}
}
