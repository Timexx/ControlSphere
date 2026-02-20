/**
 * Output Normalizer
 * Normalizes and cleans terminal/command output
 * Handles binary data, ANSI codes, noise reduction
 */

import { ILogger } from '../../types/logger'

export interface NormalizedOutput {
  text: string
  isBinary: boolean
  printableRatio: number
  originalLength: number
}

export interface IOutputNormalizer {
  normalize(data: Buffer | string): NormalizedOutput
}

export class OutputNormalizer implements IOutputNormalizer {
  private readonly TEXT_DECODER = new TextDecoder('utf-8', { fatal: false })
  private readonly MIN_PRINTABLE_RATIO = 0.6 // 60% must be printable

  constructor(private readonly logger: ILogger) {}

  /**
   * Normalize output chunk
   * - Decode buffer to text
   * - Filter noise (non-printable characters)
   * - Preserve ANSI codes
   */
  normalize(data: Buffer | string): NormalizedOutput {
    try {
      const originalLength = typeof data === 'string' ? data.length : data.length
      
      // Decode to string
      const text = this.decodeData(data)
      
      // Check if decoding produced replacement characters (indicates invalid UTF-8)
      // U+FFFD is the replacement character used by TextDecoder for invalid sequences
      if (text.includes('\ufffd')) {
        this.logger.debug('InvalidUtf8Detected', { originalLength })
        return {
          text: '',
          isBinary: true,
          printableRatio: 0,
          originalLength
        }
      }
      
      // Calculate printability
      const { printable, ratio } = this.calculatePrintability(text)
      
      // Drop chunks that are mostly non-printable noise
      if (ratio < this.MIN_PRINTABLE_RATIO) {
        this.logger.debug('OutputDropped', {
          reason: 'LowPrintableRatio',
          ratio: ratio.toFixed(2),
          length: originalLength
        })
        
        return {
          text: '',
          isBinary: true,
          printableRatio: ratio,
          originalLength
        }
      }

      return {
        text: printable,
        isBinary: false,
        printableRatio: ratio,
        originalLength
      }
    } catch (error) {
      this.logger.error('OutputNormalizationError', {
        error: (error as Error).message
      })
      return {
        text: '',
        isBinary: true,
        printableRatio: 0,
        originalLength: 0
      }
    }
  }

  /**
   * Decode buffer to string
   */
  private decodeData(data: Buffer | string): string {
    if (typeof data === 'string') {
      return data
    }

    // Try UTF-8 first
    try {
      return this.TEXT_DECODER.decode(data)
    } catch {
      // Fallback to latin1
      return data.toString('latin1')
    }
  }

  /**
   * Calculate printability ratio
   * Preserves ANSI codes and common control characters
   */
  private calculatePrintability(text: string): { printable: string; ratio: number } {
    if (!text || text.length === 0) {
      return { printable: '', ratio: 0 }
    }

    let printableCount = 0
    let filtered = ''

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      
      // Printable ASCII (32-126)
      if (code >= 0x20 && code <= 0x7e) {
        printableCount++
        filtered += text[i]
      }
      // Terminal control characters to preserve
      // These are essential for proper terminal emulator behaviour:
      //   0x07 BEL  - audible bell
      //   0x08 BS   - backspace / cursor left (critical for character deletion)
      //   0x09 HT   - horizontal tab
      //   0x0a LF   - line feed
      //   0x0b VT   - vertical tab
      //   0x0c FF   - form feed / clear screen
      //   0x0d CR   - carriage return
      //   0x0e SO   - shift out (alternate charset)
      //   0x0f SI   - shift in  (default charset)
      else if (
        code === 0x07 || code === 0x08 || code === 0x09 ||
        code === 0x0a || code === 0x0b || code === 0x0c ||
        code === 0x0d || code === 0x0e || code === 0x0f
      ) {
        printableCount++
        filtered += text[i]
      }
      // DEL (0x7F) - alternate backspace used by many terminals
      else if (code === 0x7f) {
        printableCount++
        filtered += text[i]
      }
      // ANSI escape sequences (ESC [ ... m) and charset selectors (ESC ( B)
      else if (code === 0x1b) {
        const next = text[i + 1]

        // CSI sequences: ESC [ ... letter
        if (next === '[') {
          let j = i + 2
          while (j < text.length && text.charCodeAt(j) < 64) {
            j++
          }
          if (j < text.length) {
            printableCount += j - i + 1
            filtered += text.substring(i, j + 1)
            i = j
            continue
          }
          // Incomplete CSI at end of chunk — preserve it so the terminal
          // emulator can combine it with the next chunk
          printableCount += text.length - i
          filtered += text.substring(i)
          i = text.length
          continue
        }

        // Charset designations like ESC ( B or ESC ) 0
        if (next && '()#%'.includes(next) && i + 2 < text.length) {
          const seq = text.substring(i, i + 3)
          printableCount += seq.length
          filtered += seq
          i = i + 2
          continue
        }
        // Lone ESC at end of chunk or other ESC sequence — preserve it so the
        // terminal emulator can handle it (may be a partial sequence split
        // across chunks)
        printableCount++
        filtered += text[i]
        continue
      }
      // UTF-8 multibyte sequences and Unicode chars (code > 127)
      else if (code > 127) {
        printableCount++
        filtered += text[i]
      }
    }

    const ratio = printableCount / text.length
    return { printable: filtered, ratio }
  }
}
