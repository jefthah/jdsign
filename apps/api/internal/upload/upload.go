// Package upload checks the files an admin uploads for a template: the ZIP that buyers download
// and the cover image (docs/spec.md 7.1–7.3). The ZIP is inspected but never extracted or run.
// The cover is decoded and encoded again as WebP, which drops metadata and hidden payloads.
package upload

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // registers the JPEG decoder for covers
	_ "image/png"  // registers the PNG decoder for covers
	"io"
	"strings"

	"github.com/gen2brain/webp" // registers the WebP decoder and encodes covers
	"image/draw"
)

const (
	// MaxZIPBytes is the largest template ZIP accepted (50 MB).
	MaxZIPBytes = 50 << 20
	// MaxZIPEntries is the most files and folders a template ZIP may contain.
	MaxZIPEntries = 5000
	// MaxZIPUnpackedBytes is the most a template ZIP may hold once extracted (250 MB).
	MaxZIPUnpackedBytes = 262_144_000

	// MaxCoverBytes is the largest cover upload (2 MB).
	MaxCoverBytes = 2 << 20
	// MaxCoverSide is the widest or tallest cover upload in pixels.
	MaxCoverSide = 4000
	// CoverFit is the box a stored cover is scaled down to fit; smaller covers keep their size.
	CoverFit = 1600
	// CoverQuality is the WebP quality of stored covers.
	CoverQuality = 85
)

// Rejection is a problem with the uploaded file itself, explained in Indonesian for the admin.
type Rejection struct {
	Message string
}

func (r *Rejection) Error() string { return r.Message }

func reject(format string, args ...any) *Rejection {
	return &Rejection{Message: fmt.Sprintf(format, args...)}
}

// CheckZIP reports whether the ZIP of the given size is safe to offer for download. A refused
// file returns a *Rejection; any other error means the file could not be read.
func CheckZIP(file io.ReaderAt, size int64) error {
	archive, err := zip.NewReader(file, size)
	// ErrInsecurePath still returns a usable reader; the name checks below explain the problem.
	if err != nil && !errors.Is(err, zip.ErrInsecurePath) {
		return reject("File bukan ZIP yang valid atau rusak. Buat ulang ZIP-nya, lalu unggah lagi.")
	}

	if count := len(archive.File); count < 1 || count > MaxZIPEntries {
		if count < 1 {
			return reject("ZIP kosong. Pastikan file template ada di dalamnya.")
		}
		return reject("ZIP berisi %d file dan folder; maksimal %d.", count, MaxZIPEntries)
	}

	var unpacked uint64
	for _, entry := range archive.File {
		if problem := unsafeName(entry.Name); problem != "" {
			return reject("ZIP ditolak karena nama file %q %s.", shorten(entry.Name), problem)
		}
		if entry.Flags&0x1 != 0 {
			return reject("ZIP ditolak karena %q dikunci kata sandi. Buat ZIP tanpa kata sandi.", shorten(entry.Name))
		}
		unpacked += entry.UncompressedSize64
		if unpacked > MaxZIPUnpackedBytes {
			return reject("Isi ZIP setelah diekstrak melebihi 250 MB.")
		}
	}

	return nil
}

// unsafeName describes why an entry name could escape the folder it is extracted into, or
// returns "" when it is fine. Backslashes count as folder separators.
func unsafeName(name string) string {
	normalized := strings.ReplaceAll(name, `\`, "/")
	switch {
	case strings.ContainsRune(normalized, 0):
		return "memuat karakter NUL"
	case strings.HasPrefix(normalized, "/"):
		return "diawali garis miring"
	case len(normalized) >= 2 && normalized[1] == ':' && isLetter(normalized[0]):
		return "diawali huruf drive"
	}
	for segment := range strings.SplitSeq(normalized, "/") {
		if segment == ".." {
			return `memuat ".."`
		}
	}

	return ""
}

func isLetter(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func shorten(name string) string {
	name = strings.ToValidUTF8(strings.ReplaceAll(name, "\x00", "?"), "?")
	if runes := []rune(name); len(runes) > 80 {
		return string(runes[:77]) + "..."
	}

	return name
}

// EncodeCover decodes a JPG, PNG, or WebP image, scales it down to fit CoverFit×CoverFit, and
// writes it to w as WebP. A refused image returns a *Rejection.
func EncodeCover(data []byte, w io.Writer) error {
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return reject("Sampul harus berupa gambar JPG, PNG, atau WebP.")
	}
	switch format {
	case "jpeg", "png", "webp":
	default:
		return reject("Sampul harus berupa gambar JPG, PNG, atau WebP.")
	}
	if config.Width < 1 || config.Height < 1 {
		return reject("Gambar sampul tidak bisa dibaca.")
	}
	if config.Width > MaxCoverSide || config.Height > MaxCoverSide {
		return reject("Sampul %d×%d px terlalu besar; maksimal %d×%d px.", config.Width, config.Height, MaxCoverSide, MaxCoverSide)
	}

	// The dimensions were checked above, so decoding cannot allocate more than a 4000×4000 image.
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return reject("Gambar sampul rusak atau tidak lengkap. Simpan ulang gambarnya, lalu unggah lagi.")
	}

	if err := webp.Encode(w, fit(source, CoverFit), webp.Options{Quality: CoverQuality}); err != nil {
		return fmt.Errorf("mengodekan sampul ke WebP: %w", err)
	}

	return nil
}

// fit scales the image down, keeping its proportions, so neither side exceeds limit.
//
// It averages the source pixels that fall on each output pixel (a box filter), one source row
// at a time. That keeps memory to the output image plus two rows; the kernels in
// golang.org/x/image/draw need a float64 buffer of output width × source height, over 200 MB for
// a 4000 px cover, which the API container cannot spare.
func fit(source image.Image, limit int) image.Image {
	bounds := source.Bounds()
	sourceWidth, sourceHeight := bounds.Dx(), bounds.Dy()
	if sourceWidth <= limit && sourceHeight <= limit {
		return source
	}

	width, height := limit, limit
	if sourceWidth >= sourceHeight {
		height = max(1, sourceHeight*limit/sourceWidth)
	} else {
		width = max(1, sourceWidth*limit/sourceHeight)
	}

	// Columns are the same for every row: source column x lands on output column column[x].
	column := make([]int, sourceWidth)
	for x := range column {
		column[x] = x * width / sourceWidth
	}

	scaled := image.NewRGBA(image.Rect(0, 0, width, height))
	row := image.NewRGBA(image.Rect(0, 0, sourceWidth, 1))
	sums := make([]uint64, width*4)
	counts := make([]uint64, width)
	for outY := range height {
		clear(sums)
		clear(counts)
		top, bottom := outY*sourceHeight/height, (outY+1)*sourceHeight/height
		for y := top; y < max(bottom, top+1); y++ {
			// Premultiplied RGBA, so transparent pixels do not bleed their color into the average.
			draw.Draw(row, row.Bounds(), source, image.Pt(bounds.Min.X, bounds.Min.Y+y), draw.Src)
			for x, outX := range column {
				pixel := row.Pix[x*4 : x*4+4]
				sums[outX*4] += uint64(pixel[0])
				sums[outX*4+1] += uint64(pixel[1])
				sums[outX*4+2] += uint64(pixel[2])
				sums[outX*4+3] += uint64(pixel[3])
				counts[outX]++
			}
		}
		line := scaled.Pix[outY*scaled.Stride:]
		for outX, count := range counts {
			for channel := range 4 {
				line[outX*4+channel] = uint8((sums[outX*4+channel] + count/2) / count)
			}
		}
	}

	return scaled
}
