package media

import (
	"strings"
	"testing"
)

// MEDIA-VARIANT-AUTOROTATE-001（2026-10-03，用户在服务器上验收时撞到）
//
// 现象：容器里上传的照片永远出不来 —— 资产停在 FAILED / REJECTED_TECHNICAL，
// media.processing_jobs 里 DEAD_LETTER，attempts=5。
//
// 真因不是一个坏的 ffmpeg，是一个**跨版本语义相反的参数**：`-autorotate`。同一份命令实测
//   · Alpine 的 ffmpeg 6.1.1：裸 `-autorotate` → exit 234（"cannot be applied to output
//     url"）；`-autorotate 1` → 正常。
//   · 本机 brew 的 ffmpeg 9.0.1：裸 `-autorotate` → 正常；`-autorotate 1` → exit 234
//     （"1" 被当成输出文件名）。
// 所以按任何一边的"正确答案"改，都会把另一边弄挂 —— 我第一次按服务器改，本地
// TestImageGoesReadyThroughTheWorker / TestWatermarkBurnedIntoVariant 立刻红了。
// 两边一致的唯一写法是不传这个选项：autorotate 默认开，实测输出字节完全相同。
//
// 为什么"本机的绿"当初抓不到服务器上那个死法：这条 ffmpeg 路径在本机虽然被单测覆盖，
// 但开发库上没有 worker 进程在跑（media 表里几百行 UPLOADING 就是证据），线上形态
// （CGO_ENABLED=0 + 独立 worker 容器 + Alpine ffmpeg）从没端到端跑过。AGENTS.md 说
// "绿色单测不是外部依赖的证据"，这条就是那句话说的事。
func TestVariantFFmpegArgsOmitCrossVersionAutorotate(t *testing.T) {
	args := variantFFmpegArgs("/store/original.jpg", "scale=64:64", "/store/tmp-out.jpg")

	for i, a := range args {
		if a == "-autorotate" {
			t.Fatalf("args[%d] 又出现 -autorotate 了：%q — 这个选项在 ffmpeg 6.1 要带值、在 9.0 不能带值，"+
				"任何一种写法都会在一边 exit 234。默认本来就是开的，别加回来", i, args)
		}
	}
	// 输入必须紧跟 -i，输出必须是最后一个参数：这两个位置错了就是同一种"选项跑到输出上"的病。
	if args[0] != "-y" {
		t.Fatalf("args = %q — 第一个参数应当是 -y（覆盖已存在的临时文件，否则 ffmpeg 会等交互确认）", args)
	}
	inputAt := -1
	for i, a := range args {
		if a == "-i" {
			inputAt = i
			break
		}
	}
	if inputAt < 0 || args[inputAt+1] != "/store/original.jpg" {
		t.Fatalf("args = %q — -i 后面必须直接是原图路径", args)
	}
	if last := args[len(args)-1]; last != "/store/tmp-out.jpg" {
		t.Fatalf("args = %q — 最后一个参数必须是输出路径，实得 %q", args, last)
	}
}

// 同一个 bug 的配套教训：报错截断的方向。ffmpeg 先打 banner 再打真正的错，
// 从头截 200 字节等于只留版本号 —— 那条 DEAD_LETTER 存的就是 200 字符 banner，
// 我是靠进容器手工复现才定位到 "Option autorotate …"。
func TestClippedOutputKeepsTheTail(t *testing.T) {
	out := []byte(strings.Repeat("x", 1000) + "\nOption autorotate cannot be applied to output url /tmp/in.jpg\n")
	got := clippedOutput(out)
	if !strings.Contains(got, "cannot be applied to output url") {
		t.Fatalf("clippedOutput 把真正的错误行截掉了：%q", got)
	}
	if len(got) > 400 {
		t.Fatalf("clippedOutput 长度 %d，必须截到 400 以内", len(got))
	}
	if short := clippedOutput([]byte("boom")); short != "boom" {
		t.Fatalf("短输出被改坏了：%q", short)
	}
}
