// wav.go —— the one audio shape the engine reads: RIFF/WAVE, PCM 16-bit, mono, 16 kHz. The SDK's
// recorder produces exactly this; anything else is refused rather than guessed at.

package stt

import (
	"encoding/binary"
	"errors"
	"fmt"
)

const (
	sampleRate = 16000
	// riffHeader —— "RIFF" <size> "WAVE"; chunkHeader —— <id> <size>.
	riffHeader  = 12
	chunkHeader = 8
	// fmtLen —— the PCM fmt chunk's fields we read (format … bits per sample).
	fmtLen        = 16
	bitsPerSample = 16
	pcmFormat     = 1
	// int16Scale —— a 16-bit sample's full scale, mapping it into [-1, 1).
	int16Scale = 32768
)

var errNotWAV = errors.New("not a 16 kHz mono 16-bit PCM WAV")

// decodeWAV —— the samples as float32 in [-1, 1].
func decodeWAV(b []byte) ([]float32, error) {
	if !isWAVE(b) {
		return nil, errNotWAV
	}
	c := chunks(b)
	if c.data == nil {
		return nil, fmt.Errorf("%w: no data chunk", errNotWAV)
	}
	if !validFormat(c.format) {
		return nil, errNotWAV
	}
	return pcm16(c.data), nil
}

// wavChunks —— the two chunks a WAV decode needs.
type wavChunks struct {
	format []byte
	data   []byte
}

func isWAVE(b []byte) bool {
	return len(b) >= riffHeader && string(b[0:4]) == "RIFF" && string(b[8:riffHeader]) == "WAVE"
}

// chunks —— the "fmt " chunk seen before the first "data" chunk, and that data chunk (nil if none).
func chunks(b []byte) wavChunks {
	var c wavChunks
	for off := riffHeader; off+chunkHeader <= len(b); {
		id, chunk := nextChunk(b, off)
		switch id {
		case "data":
			c.data = chunk
			return c
		case "fmt ":
			c.format = chunk
		default:
		}
		off += chunkHeader + len(chunk) + len(chunk)%2
	}
	return c
}

// nextChunk —— the chunk at off: its id and body. A recorder that never patched the length gets
// read to the end of the file.
func nextChunk(b []byte, off int) (string, []byte) {
	size := int(binary.LittleEndian.Uint32(b[off+4 : off+chunkHeader]))
	body := off + chunkHeader
	size = min(size, len(b)-body)
	return string(b[off : off+4]), b[body : body+size]
}

func validFormat(f []byte) bool {
	if len(f) < fmtLen {
		return false
	}
	format := binary.LittleEndian.Uint16(f[0:2])
	channels := binary.LittleEndian.Uint16(f[2:4])
	rate := binary.LittleEndian.Uint32(f[4:8])
	bits := binary.LittleEndian.Uint16(f[14:fmtLen])
	return format == pcmFormat && channels == 1 && rate == sampleRate && bits == bitsPerSample
}

func pcm16(d []byte) []float32 {
	out := make([]float32, len(d)/2)
	for i := range out {
		out[i] = float32(int16(binary.LittleEndian.Uint16(d[2*i:]))) / int16Scale
	}
	return out
}
