package media

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

type sourceImageMetadata struct {
	Width       int
	Height      int
	Orientation int // EXIF orientation 1..8; 0 means unknown.
	ColorSpace  string
	HasAlpha    bool
	Animated    bool
	FrameCount  int
	DurationMs  int64
}

func readSourceImageMetadata(ctx context.Context, path, mime string) sourceImageMetadata {
	meta := sourceImageMetadata{}
	file, err := os.Open(path)
	if err == nil {
		header, _ := io.ReadAll(io.LimitReader(file, 2<<20))
		_ = file.Close()
		switch mime {
		case "image/jpeg":
			readJPEGMetadata(header, &meta)
		case "image/png":
			readPNGMetadata(header, &meta)
		}
	}
	mergeFFProbeImageMetadata(ctx, path, &meta)
	return meta
}

func readJPEGMetadata(data []byte, meta *sourceImageMetadata) {
	if len(data) < 4 || data[0] != 0xff || data[1] != 0xd8 {
		return
	}
	for offset := 2; offset+4 <= len(data); {
		if data[offset] != 0xff {
			offset++
			continue
		}
		marker := data[offset+1]
		if marker == 0xd9 || marker == 0xda {
			break
		}
		length := int(binary.BigEndian.Uint16(data[offset+2 : offset+4]))
		if length < 2 || offset+2+length > len(data) {
			break
		}
		payload := data[offset+4 : offset+2+length]
		if marker == 0xe1 && len(payload) > 6 && string(payload[:6]) == "Exif\x00\x00" {
			readTIFFMetadata(payload[6:], meta)
		}
		if marker == 0xe2 && len(payload) >= 12 && string(payload[:12]) == "ICC_PROFILE\x00" {
			meta.ColorSpace = "ICC"
		}
		offset += 2 + length
	}
}

func readTIFFMetadata(tiff []byte, meta *sourceImageMetadata) {
	if len(tiff) < 8 {
		return
	}
	var order binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return
	}
	if order.Uint16(tiff[2:4]) != 42 {
		return
	}
	ifd0 := int(order.Uint32(tiff[4:8]))
	exifIFD := readIFD(tiff, ifd0, order, meta)
	if exifIFD > 0 {
		readIFD(tiff, exifIFD, order, meta)
	}
}

func readIFD(data []byte, offset int, order binary.ByteOrder, meta *sourceImageMetadata) int {
	if offset < 0 || offset+2 > len(data) {
		return 0
	}
	count := int(order.Uint16(data[offset : offset+2]))
	exifIFD := 0
	for index := 0; index < count; index++ {
		entry := offset + 2 + index*12
		if entry+12 > len(data) {
			break
		}
		tag := order.Uint16(data[entry : entry+2])
		typeID := order.Uint16(data[entry+2 : entry+4])
		itemCount := order.Uint32(data[entry+4 : entry+8])
		switch tag {
		case 0x0112: // Orientation
			if typeID == 3 && itemCount == 1 {
				value := int(order.Uint16(data[entry+8 : entry+10]))
				if value >= 1 && value <= 8 {
					meta.Orientation = value
				}
			}
		case 0x8769: // Exif IFD pointer
			if typeID == 4 && itemCount == 1 {
				exifIFD = int(order.Uint32(data[entry+8 : entry+12]))
			}
		case 0xa001: // Exif ColorSpace
			if typeID == 3 && itemCount == 1 {
				switch order.Uint16(data[entry+8 : entry+10]) {
				case 1:
					meta.ColorSpace = "SRGB"
				case 0xffff:
					if meta.ColorSpace == "" {
						meta.ColorSpace = "UNCALIBRATED"
					}
				}
			}
		}
	}
	return exifIFD
}

func readPNGMetadata(data []byte, meta *sourceImageMetadata) {
	if len(data) < 33 || string(data[:8]) != "\x89PNG\r\n\x1a\n" {
		return
	}
	meta.Width = int(binary.BigEndian.Uint32(data[16:20]))
	meta.Height = int(binary.BigEndian.Uint32(data[20:24]))
	colorType := data[25]
	meta.HasAlpha = colorType == 4 || colorType == 6
	for offset := 8; offset+12 <= len(data); {
		length := int(binary.BigEndian.Uint32(data[offset : offset+4]))
		if length < 0 || offset+12+length > len(data) {
			break
		}
		chunkType := string(data[offset+4 : offset+8])
		switch chunkType {
		case "sRGB":
			meta.ColorSpace = "SRGB"
		case "iCCP":
			meta.ColorSpace = "ICC"
		case "acTL":
			meta.Animated = true
		}
		offset += 12 + length
	}
}

func mergeFFProbeImageMetadata(ctx context.Context, path string, meta *sourceImageMetadata) {
	if _, err := exec.LookPath("ffprobe"); err != nil {
		return
	}
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "quiet", "-print_format", "json",
		"-show_entries", "stream=width,height,pix_fmt,color_space,color_primaries,nb_frames,duration:format=duration:stream_tags=rotate:stream_side_data=rotation", path)
	out, err := cmd.Output()
	if err != nil {
		return
	}
	var info struct {
		Streams []struct {
			Width          int    `json:"width"`
			Height         int    `json:"height"`
			PixelFormat    string `json:"pix_fmt"`
			ColorSpace     string `json:"color_space"`
			ColorPrimaries string `json:"color_primaries"`
			Frames         string `json:"nb_frames"`
			Duration       string `json:"duration"`
			Tags           struct {
				Rotate string `json:"rotate"`
			} `json:"tags"`
			SideData []struct {
				Rotation int `json:"rotation"`
			} `json:"side_data_list"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if json.Unmarshal(out, &info) != nil || len(info.Streams) == 0 {
		return
	}
	stream := info.Streams[0]
	if meta.Width == 0 {
		meta.Width = stream.Width
	}
	if meta.Height == 0 {
		meta.Height = stream.Height
	}
	if meta.ColorSpace == "" {
		space := stream.ColorSpace
		if space == "" || space == "unknown" {
			space = stream.ColorPrimaries
		}
		if space != "" && space != "unknown" {
			meta.ColorSpace = strings.ToUpper(space)
		}
	}
	if strings.Contains(stream.PixelFormat, "rgba") || strings.Contains(stream.PixelFormat, "bgra") || strings.Contains(stream.PixelFormat, "yuva") {
		meta.HasAlpha = true
	}
	if frames, err := strconv.Atoi(stream.Frames); err == nil && frames > 1 {
		meta.Animated = true
		meta.FrameCount = frames
	}
	duration := stream.Duration
	if duration == "" || duration == "N/A" {
		duration = info.Format.Duration
	}
	if seconds, err := strconv.ParseFloat(duration, 64); err == nil && seconds > 0 {
		meta.DurationMs = int64(seconds*1000 + 0.5)
	}
	if meta.Orientation == 0 {
		rotation := 0
		if value, err := strconv.Atoi(stream.Tags.Rotate); err == nil {
			rotation = value
		}
		if len(stream.SideData) > 0 && stream.SideData[0].Rotation != 0 {
			rotation = stream.SideData[0].Rotation
		}
		switch ((rotation % 360) + 360) % 360 {
		case 0:
			meta.Orientation = 1
		case 90:
			meta.Orientation = 6
		case 180:
			meta.Orientation = 3
		case 270:
			meta.Orientation = 8
		}
	}
}
