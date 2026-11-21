package upload

import (
	"archive/zip"
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"
)

type entry struct {
	name      string
	encrypted bool
	unpacked  uint64 // claimed size; 0 means the real content size
}

func buildZIP(t *testing.T, entries ...entry) []byte {
	t.Helper()

	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, e := range entries {
		content := []byte("isi " + e.name)
		if e.unpacked > 0 {
			header := &zip.FileHeader{Name: e.name, Method: zip.Store, CompressedSize64: uint64(len(content)), UncompressedSize64: e.unpacked}
			raw, err := writer.CreateRaw(header)
			if err != nil {
				t.Fatal(err)
			}
			_, _ = raw.Write(content)
			continue
		}
		header := &zip.FileHeader{Name: e.name, Method: zip.Deflate}
		if e.encrypted {
			header.Flags |= 0x1
		}
		file, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = file.Write(content)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	return buffer.Bytes()
}

func checkZIP(data []byte) error {
	return CheckZIP(bytes.NewReader(data), int64(len(data)))
}

func assertRejected(t *testing.T, err error, contains string) {
	t.Helper()

	var rejection *Rejection
	if !errors.As(err, &rejection) {
		t.Fatalf("error = %v, want a rejection mentioning %q", err, contains)
	}
	if !strings.Contains(rejection.Message, contains) {
		t.Fatalf("rejection = %q, want it to mention %q", rejection.Message, contains)
	}
}

func TestCheckZIPAcceptsATemplate(t *testing.T) {
	data := buildZIP(t, entry{name: "arunika/"}, entry{name: "arunika/index.html"}, entry{name: `arunika\css\style.css`})
	if err := checkZIP(data); err != nil {
		t.Fatalf("valid ZIP refused: %v", err)
	}
}

func TestCheckZIPRefusesUnsafeArchives(t *testing.T) {
	tests := []struct {
		name     string
		data     []byte
		contains string
	}{
		{"not a zip", []byte("bukan zip sama sekali"), "bukan ZIP"},
		{"empty", buildZIP(t), "ZIP kosong"},
		{"parent folder", buildZIP(t, entry{name: "ok.txt"}, entry{name: "../luar.txt"}), `".."`},
		{"parent folder with backslash", buildZIP(t, entry{name: `assets\..\..\luar.txt`}), `".."`},
		{"absolute path", buildZIP(t, entry{name: "/etc/passwd"}), "garis miring"},
		{"drive letter", buildZIP(t, entry{name: "C:/Windows/win.ini"}), "huruf drive"},
		{"NUL byte", buildZIP(t, entry{name: "index\x00.html"}), "NUL"},
		{"encrypted", buildZIP(t, entry{name: "rahasia.txt", encrypted: true}), "kata sandi"},
		{"too large unpacked", buildZIP(t, entry{name: "besar.bin", unpacked: MaxZIPUnpackedBytes + 1}), "250 MB"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertRejected(t, checkZIP(test.data), test.contains)
		})
	}
}

func TestCheckZIPLimitsEntries(t *testing.T) {
	entries := make([]entry, MaxZIPEntries+1)
	for i := range entries {
		entries[i] = entry{name: "f/" + strings.Repeat("a", i%50) + string(rune('a'+i%26))}
	}
	assertRejected(t, checkZIP(buildZIP(t, entries...)), "maksimal 5000")
}

func encodeImage(t *testing.T, format string, width, height int) []byte {
	t.Helper()

	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
			img.Set(x, y, color.NRGBA{R: uint8(x), G: uint8(y), B: 160, A: 255})
		}
	}
	var buffer bytes.Buffer
	var err error
	switch format {
	case "png":
		err = png.Encode(&buffer, img)
	case "jpeg":
		err = jpeg.Encode(&buffer, img, nil)
	case "gif":
		err = gif.Encode(&buffer, img, nil)
	}
	if err != nil {
		t.Fatal(err)
	}

	return buffer.Bytes()
}

func TestEncodeCoverMakesAScaledWebP(t *testing.T) {
	tests := []struct {
		format        string
		width, height int
		wantW, wantH  int
	}{
		{"png", 2400, 1500, 1600, 1000},
		{"jpeg", 900, 2000, 720, 1600},
		{"png", 640, 400, 640, 400},
	}
	for _, test := range tests {
		var out bytes.Buffer
		if err := EncodeCover(encodeImage(t, test.format, test.width, test.height), &out); err != nil {
			t.Fatalf("%s %dx%d: %v", test.format, test.width, test.height, err)
		}
		config, format, err := image.DecodeConfig(bytes.NewReader(out.Bytes()))
		if err != nil || format != "webp" {
			t.Fatalf("output format = %q, err = %v; want webp", format, err)
		}
		if config.Width != test.wantW || config.Height != test.wantH {
			t.Fatalf("%dx%d became %dx%d, want %dx%d", test.width, test.height, config.Width, config.Height, test.wantW, test.wantH)
		}
	}

	// A WebP upload is accepted and encoded again.
	var first, second bytes.Buffer
	if err := EncodeCover(encodeImage(t, "png", 300, 200), &first); err != nil {
		t.Fatal(err)
	}
	if err := EncodeCover(first.Bytes(), &second); err != nil {
		t.Fatalf("WebP cover refused: %v", err)
	}
}

func TestEncodeCoverRefusesOtherFiles(t *testing.T) {
	assertRejected(t, EncodeCover([]byte("<svg xmlns='http://www.w3.org/2000/svg'/>"), &bytes.Buffer{}), "JPG, PNG, atau WebP")
	assertRejected(t, EncodeCover(encodeImage(t, "gif", 20, 20), &bytes.Buffer{}), "JPG, PNG, atau WebP")
	assertRejected(t, EncodeCover(encodeImage(t, "png", MaxCoverSide+1, 4), &bytes.Buffer{}), "terlalu besar")

	truncated := encodeImage(t, "png", 200, 200)
	assertRejected(t, EncodeCover(truncated[:len(truncated)/2], &bytes.Buffer{}), "rusak")
}
