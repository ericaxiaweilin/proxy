package media

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

const (
	maxImageSourceBytes = int64(25 << 20)
	maxImageDimension   = 20_000
	maxImagePixels      = int64(80_000_000)
)

var supportedImageMIMEs = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
	"image/heic": true,
	"image/avif": true,
}

// validateQuarantinedImage performs format and decompression-bomb admission
// before ffmpeg receives the file. Content-policy review can replace the local
// approval step later; these technical checks remain mandatory either way.
func validateQuarantinedImage(ctx context.Context, path string, asset MediaAsset) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return err
	}
	if stat.Size() <= 0 || stat.Size() > maxImageSourceBytes {
		return fmt.Errorf("image source size %d is outside the processing limit", stat.Size())
	}
	reader := bufio.NewReader(io.LimitReader(file, 4096))
	header, err := reader.Peek(512)
	if err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	detected := strings.ToLower(detectMediaMime(header))
	if !supportedImageMIMEs[detected] || !mediaMimeAllowed("IMAGE", asset.MimeType, detected) {
		return fmt.Errorf("unsupported or mismatched image format: %s", detected)
	}
	metadata := readSourceImageMetadata(ctx, path, detected)
	if metadata.Width <= 0 || metadata.Height <= 0 {
		return errors.New("image dimensions cannot be decoded")
	}
	if metadata.Width > maxImageDimension || metadata.Height > maxImageDimension || int64(metadata.Width)*int64(metadata.Height) > maxImagePixels {
		return fmt.Errorf("image dimensions %dx%d exceed safe decode limits", metadata.Width, metadata.Height)
	}
	if metadata.Animated {
		return errors.New("animated images are not supported in the P0 photo pipeline")
	}
	return nil
}
